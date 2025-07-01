import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import * as stream from "stream";
import * as async from 'async';
import BlockStream2 from 'block-stream2';
import { isBrowser } from 'browser-or-node';
import _ from 'lodash';
import * as qs from 'query-string';
import xml2js from 'xml2js';
import { CredentialProvider } from "../CredentialProvider.mjs";
import * as errors from "../errors.mjs";
import { CopyDestinationOptions, CopySourceOptions, DEFAULT_REGION, LEGAL_HOLD_STATUS, PRESIGN_EXPIRY_DAYS_MAX, RETENTION_MODES, RETENTION_VALIDITY_UNITS } from "../helpers.mjs";
import { postPresignSignatureV4, presignSignatureV4, signV4 } from "../signing.mjs";
import { fsp, streamPromise } from "./async.mjs";
import { CopyConditions } from "./copy-conditions.mjs";
import { Extensions } from "./extensions.mjs";
import { calculateEvenSplits, extractMetadata, getContentLength, getScope, getSourceVersionId, getVersionId, hashBinary, insertContentType, isAmazonEndpoint, isBoolean, isDefined, isEmpty, isNumber, isObject, isReadableStream, isString, isValidBucketName, isValidEndpoint, isValidObjectName, isValidPort, isValidPrefix, isVirtualHostStyle, makeDateLong, PART_CONSTRAINTS, partsRequired, prependXAMZMeta, readableStream, sanitizeETag, toMd5, toSha256, uriEscape, uriResourceEscape } from "./helper.mjs";
import { joinHostPort } from "./join-host-port.mjs";
import { PostPolicy } from "./post-policy.mjs";
import { requestWithRetry } from "./request.mjs";
import { drainResponse, readAsBuffer, readAsString } from "./response.mjs";
import { getS3Endpoint } from "./s3-endpoints.mjs";
import { parseCompleteMultipart, parseInitiateMultipart, parseListObjects, parseObjectLegalHoldConfig, parseSelectObjectContentResponse, uploadPartParser } from "./xml-parser.mjs";
import * as xmlParsers from "./xml-parser.mjs";
const xml = new xml2js.Builder({
  renderOpts: {
    pretty: false
  },
  headless: true
});

// will be replaced by bundler.
const Package = {
  version: "8.0.5" || 'development'
};
const requestOptionProperties = ['agent', 'ca', 'cert', 'ciphers', 'clientCertEngine', 'crl', 'dhparam', 'ecdhCurve', 'family', 'honorCipherOrder', 'key', 'passphrase', 'pfx', 'rejectUnauthorized', 'secureOptions', 'secureProtocol', 'servername', 'sessionIdContext'];
export class TypedClient {
  partSize = 64 * 1024 * 1024;
  maximumPartSize = 5 * 1024 * 1024 * 1024;
  maxObjectSize = 5 * 1024 * 1024 * 1024 * 1024;
  constructor(params) {
    // @ts-expect-error deprecated property
    if (params.secure !== undefined) {
      throw new Error('"secure" option deprecated, "useSSL" should be used instead');
    }
    // Default values if not specified.
    if (params.useSSL === undefined) {
      params.useSSL = true;
    }
    if (!params.port) {
      params.port = 0;
    }
    // Validate input params.
    if (!isValidEndpoint(params.endPoint)) {
      throw new errors.InvalidEndpointError(`Invalid endPoint : ${params.endPoint}`);
    }
    if (!isValidPort(params.port)) {
      throw new errors.InvalidArgumentError(`Invalid port : ${params.port}`);
    }
    if (!isBoolean(params.useSSL)) {
      throw new errors.InvalidArgumentError(`Invalid useSSL flag type : ${params.useSSL}, expected to be of type "boolean"`);
    }

    // Validate region only if its set.
    if (params.region) {
      if (!isString(params.region)) {
        throw new errors.InvalidArgumentError(`Invalid region : ${params.region}`);
      }
    }
    const host = params.endPoint.toLowerCase();
    let port = params.port;
    let protocol;
    let transport;
    let transportAgent;
    // Validate if configuration is not using SSL
    // for constructing relevant endpoints.
    if (params.useSSL) {
      // Defaults to secure.
      transport = https;
      protocol = 'https:';
      port = port || 443;
      transportAgent = https.globalAgent;
    } else {
      transport = http;
      protocol = 'http:';
      port = port || 80;
      transportAgent = http.globalAgent;
    }

    // if custom transport is set, use it.
    if (params.transport) {
      if (!isObject(params.transport)) {
        throw new errors.InvalidArgumentError(`Invalid transport type : ${params.transport}, expected to be type "object"`);
      }
      transport = params.transport;
    }

    // if custom transport agent is set, use it.
    if (params.transportAgent) {
      if (!isObject(params.transportAgent)) {
        throw new errors.InvalidArgumentError(`Invalid transportAgent type: ${params.transportAgent}, expected to be type "object"`);
      }
      transportAgent = params.transportAgent;
    }

    // User Agent should always following the below style.
    // Please open an issue to discuss any new changes here.
    //
    //       MinIO (OS; ARCH) LIB/VER APP/VER
    //
    const libraryComments = `(${process.platform}; ${process.arch})`;
    const libraryAgent = `MinIO ${libraryComments} minio-js/${Package.version}`;
    // User agent block ends.

    this.transport = transport;
    this.transportAgent = transportAgent;
    this.host = host;
    this.port = port;
    this.protocol = protocol;
    this.userAgent = `${libraryAgent}`;

    // Default path style is true
    if (params.pathStyle === undefined) {
      this.pathStyle = true;
    } else {
      this.pathStyle = params.pathStyle;
    }
    this.accessKey = params.accessKey ?? '';
    this.secretKey = params.secretKey ?? '';
    this.sessionToken = params.sessionToken;
    this.anonymous = !this.accessKey || !this.secretKey;
    if (params.credentialsProvider) {
      this.anonymous = false;
      this.credentialsProvider = params.credentialsProvider;
    }
    this.regionMap = {};
    if (params.region) {
      this.region = params.region;
    }
    if (params.partSize) {
      this.partSize = params.partSize;
      this.overRidePartSize = true;
    }
    if (this.partSize < 5 * 1024 * 1024) {
      throw new errors.InvalidArgumentError(`Part size should be greater than 5MB`);
    }
    if (this.partSize > 5 * 1024 * 1024 * 1024) {
      throw new errors.InvalidArgumentError(`Part size should be less than 5GB`);
    }

    // SHA256 is enabled only for authenticated http requests. If the request is authenticated
    // and the connection is https we use x-amz-content-sha256=UNSIGNED-PAYLOAD
    // header for signature calculation.
    this.enableSHA256 = !this.anonymous && !params.useSSL;
    this.s3AccelerateEndpoint = params.s3AccelerateEndpoint || undefined;
    this.reqOptions = {};
    this.clientExtensions = new Extensions(this);
  }
  /**
   * Minio extensions that aren't necessary present for Amazon S3 compatible storage servers
   */
  get extensions() {
    return this.clientExtensions;
  }

  /**
   * @param endPoint - valid S3 acceleration end point
   */
  setS3TransferAccelerate(endPoint) {
    this.s3AccelerateEndpoint = endPoint;
  }

  /**
   * Sets the supported request options.
   */
  setRequestOptions(options) {
    if (!isObject(options)) {
      throw new TypeError('request options should be of type "object"');
    }
    this.reqOptions = _.pick(options, requestOptionProperties);
  }

  /**
   *  This is s3 Specific and does not hold validity in any other Object storage.
   */
  getAccelerateEndPointIfSet(bucketName, objectName) {
    if (!isEmpty(this.s3AccelerateEndpoint) && !isEmpty(bucketName) && !isEmpty(objectName)) {
      // http://docs.aws.amazon.com/AmazonS3/latest/dev/transfer-acceleration.html
      // Disable transfer acceleration for non-compliant bucket names.
      if (bucketName.includes('.')) {
        throw new Error(`Transfer Acceleration is not supported for non compliant bucket:${bucketName}`);
      }
      // If transfer acceleration is requested set new host.
      // For more details about enabling transfer acceleration read here.
      // http://docs.aws.amazon.com/AmazonS3/latest/dev/transfer-acceleration.html
      return this.s3AccelerateEndpoint;
    }
    return false;
  }

  /**
   *   Set application specific information.
   *   Generates User-Agent in the following style.
   *   MinIO (OS; ARCH) LIB/VER APP/VER
   */
  setAppInfo(appName, appVersion) {
    if (!isString(appName)) {
      throw new TypeError(`Invalid appName: ${appName}`);
    }
    if (appName.trim() === '') {
      throw new errors.InvalidArgumentError('Input appName cannot be empty.');
    }
    if (!isString(appVersion)) {
      throw new TypeError(`Invalid appVersion: ${appVersion}`);
    }
    if (appVersion.trim() === '') {
      throw new errors.InvalidArgumentError('Input appVersion cannot be empty.');
    }
    this.userAgent = `${this.userAgent} ${appName}/${appVersion}`;
  }

  /**
   * returns options object that can be used with http.request()
   * Takes care of constructing virtual-host-style or path-style hostname
   */
  getRequestOptions(opts) {
    const method = opts.method;
    const region = opts.region;
    const bucketName = opts.bucketName;
    let objectName = opts.objectName;
    const headers = opts.headers;
    const query = opts.query;
    let reqOptions = {
      method,
      headers: {},
      protocol: this.protocol,
      // If custom transportAgent was supplied earlier, we'll inject it here
      agent: this.transportAgent
    };

    // Verify if virtual host supported.
    let virtualHostStyle;
    if (bucketName) {
      virtualHostStyle = isVirtualHostStyle(this.host, this.protocol, bucketName, this.pathStyle);
    }
    let path = '/';
    let host = this.host;
    let port;
    if (this.port) {
      port = this.port;
    }
    if (objectName) {
      objectName = uriResourceEscape(objectName);
    }

    // For Amazon S3 endpoint, get endpoint based on region.
    if (isAmazonEndpoint(host)) {
      const accelerateEndPoint = this.getAccelerateEndPointIfSet(bucketName, objectName);
      if (accelerateEndPoint) {
        host = `${accelerateEndPoint}`;
      } else {
        host = getS3Endpoint(region);
      }
    }
    if (virtualHostStyle && !opts.pathStyle) {
      // For all hosts which support virtual host style, `bucketName`
      // is part of the hostname in the following format:
      //
      //  var host = 'bucketName.example.com'
      //
      if (bucketName) {
        host = `${bucketName}.${host}`;
      }
      if (objectName) {
        path = `/${objectName}`;
      }
    } else {
      // For all S3 compatible storage services we will fallback to
      // path style requests, where `bucketName` is part of the URI
      // path.
      if (bucketName) {
        path = `/${bucketName}`;
      }
      if (objectName) {
        path = `/${bucketName}/${objectName}`;
      }
    }
    if (query) {
      path += `?${query}`;
    }
    reqOptions.headers.host = host;
    if (reqOptions.protocol === 'http:' && port !== 80 || reqOptions.protocol === 'https:' && port !== 443) {
      reqOptions.headers.host = joinHostPort(host, port);
    }
    reqOptions.headers['user-agent'] = this.userAgent;
    if (headers) {
      // have all header keys in lower case - to make signing easy
      for (const [k, v] of Object.entries(headers)) {
        reqOptions.headers[k.toLowerCase()] = v;
      }
    }

    // Use any request option specified in minioClient.setRequestOptions()
    reqOptions = Object.assign({}, this.reqOptions, reqOptions);
    return {
      ...reqOptions,
      headers: _.mapValues(_.pickBy(reqOptions.headers, isDefined), v => v.toString()),
      host,
      port,
      path
    };
  }
  async setCredentialsProvider(credentialsProvider) {
    if (!(credentialsProvider instanceof CredentialProvider)) {
      throw new Error('Unable to get credentials. Expected instance of CredentialProvider');
    }
    this.credentialsProvider = credentialsProvider;
    await this.checkAndRefreshCreds();
  }
  async checkAndRefreshCreds() {
    if (this.credentialsProvider) {
      try {
        const credentialsConf = await this.credentialsProvider.getCredentials();
        this.accessKey = credentialsConf.getAccessKey();
        this.secretKey = credentialsConf.getSecretKey();
        this.sessionToken = credentialsConf.getSessionToken();
      } catch (e) {
        throw new Error(`Unable to get credentials: ${e}`, {
          cause: e
        });
      }
    }
  }
  /**
   * log the request, response, error
   */
  logHTTP(reqOptions, response, err) {
    // if no logStream available return.
    if (!this.logStream) {
      return;
    }
    if (!isObject(reqOptions)) {
      throw new TypeError('reqOptions should be of type "object"');
    }
    if (response && !isReadableStream(response)) {
      throw new TypeError('response should be of type "Stream"');
    }
    if (err && !(err instanceof Error)) {
      throw new TypeError('err should be of type "Error"');
    }
    const logStream = this.logStream;
    const logHeaders = headers => {
      Object.entries(headers).forEach(([k, v]) => {
        if (k == 'authorization') {
          if (isString(v)) {
            const redactor = new RegExp('Signature=([0-9a-f]+)');
            v = v.replace(redactor, 'Signature=**REDACTED**');
          }
        }
        logStream.write(`${k}: ${v}\n`);
      });
      logStream.write('\n');
    };
    logStream.write(`REQUEST: ${reqOptions.method} ${reqOptions.path}\n`);
    logHeaders(reqOptions.headers);
    if (response) {
      this.logStream.write(`RESPONSE: ${response.statusCode}\n`);
      logHeaders(response.headers);
    }
    if (err) {
      logStream.write('ERROR BODY:\n');
      const errJSON = JSON.stringify(err, null, '\t');
      logStream.write(`${errJSON}\n`);
    }
  }

  /**
   * Enable tracing
   */
  traceOn(stream) {
    if (!stream) {
      stream = process.stdout;
    }
    this.logStream = stream;
  }

  /**
   * Disable tracing
   */
  traceOff() {
    this.logStream = undefined;
  }

  /**
   * makeRequest is the primitive used by the apis for making S3 requests.
   * payload can be empty string in case of no payload.
   * statusCode is the expected statusCode. If response.statusCode does not match
   * we parse the XML error and call the callback with the error message.
   *
   * A valid region is passed by the calls - listBuckets, makeBucket and getBucketRegion.
   *
   * @internal
   */
  async makeRequestAsync(options, payload = '', expectedCodes = [200], region = '') {
    if (!isObject(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!isString(payload) && !isObject(payload)) {
      // Buffer is of type 'object'
      throw new TypeError('payload should be of type "string" or "Buffer"');
    }
    expectedCodes.forEach(statusCode => {
      if (!isNumber(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!isString(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (!options.headers) {
      options.headers = {};
    }
    if (options.method === 'POST' || options.method === 'PUT' || options.method === 'DELETE') {
      options.headers['content-length'] = payload.length.toString();
    }
    const sha256sum = this.enableSHA256 ? toSha256(payload) : '';
    return this.makeRequestStreamAsync(options, payload, sha256sum, expectedCodes, region);
  }

  /**
   * new request with promise
   *
   * No need to drain response, response body is not valid
   */
  async makeRequestAsyncOmit(options, payload = '', statusCodes = [200], region = '') {
    const res = await this.makeRequestAsync(options, payload, statusCodes, region);
    await drainResponse(res);
    return res;
  }

  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @internal
   */
  async makeRequestStreamAsync(options, body, sha256sum, statusCodes, region) {
    if (!isObject(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!(Buffer.isBuffer(body) || typeof body === 'string' || isReadableStream(body))) {
      throw new errors.InvalidArgumentError(`stream should be a Buffer, string or readable Stream, got ${typeof body} instead`);
    }
    if (!isString(sha256sum)) {
      throw new TypeError('sha256sum should be of type "string"');
    }
    statusCodes.forEach(statusCode => {
      if (!isNumber(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!isString(region)) {
      throw new TypeError('region should be of type "string"');
    }
    // sha256sum will be empty for anonymous or https requests
    if (!this.enableSHA256 && sha256sum.length !== 0) {
      throw new errors.InvalidArgumentError(`sha256sum expected to be empty for anonymous or https requests`);
    }
    // sha256sum should be valid for non-anonymous http requests.
    if (this.enableSHA256 && sha256sum.length !== 64) {
      throw new errors.InvalidArgumentError(`Invalid sha256sum : ${sha256sum}`);
    }
    await this.checkAndRefreshCreds();

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    region = region || (await this.getBucketRegionAsync(options.bucketName));
    const reqOptions = this.getRequestOptions({
      ...options,
      region
    });
    if (!this.anonymous) {
      // For non-anonymous https requests sha256sum is 'UNSIGNED-PAYLOAD' for signature calculation.
      if (!this.enableSHA256) {
        sha256sum = 'UNSIGNED-PAYLOAD';
      }
      const date = new Date();
      reqOptions.headers['x-amz-date'] = makeDateLong(date);
      reqOptions.headers['x-amz-content-sha256'] = sha256sum;
      if (this.sessionToken) {
        reqOptions.headers['x-amz-security-token'] = this.sessionToken;
      }
      reqOptions.headers.authorization = signV4(reqOptions, this.accessKey, this.secretKey, region, date, sha256sum);
    }
    const response = await requestWithRetry(this.transport, reqOptions, body);
    if (!response.statusCode) {
      throw new Error("BUG: response doesn't have a statusCode");
    }
    if (!statusCodes.includes(response.statusCode)) {
      // For an incorrect region, S3 server always sends back 400.
      // But we will do cache invalidation for all errors so that,
      // in future, if AWS S3 decides to send a different status code or
      // XML error code we will still work fine.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      delete this.regionMap[options.bucketName];
      const err = await xmlParsers.parseResponseError(response);
      this.logHTTP(reqOptions, response, err);
      throw err;
    }
    this.logHTTP(reqOptions, response);
    return response;
  }

  /**
   * gets the region of the bucket
   *
   * @param bucketName
   *
   * @internal
   */
  async getBucketRegionAsync(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name : ${bucketName}`);
    }

    // Region is set with constructor, return the region right here.
    if (this.region) {
      return this.region;
    }
    const cached = this.regionMap[bucketName];
    if (cached) {
      return cached;
    }
    const extractRegionAsync = async response => {
      const body = await readAsString(response);
      const region = xmlParsers.parseBucketRegion(body) || DEFAULT_REGION;
      this.regionMap[bucketName] = region;
      return region;
    };
    const method = 'GET';
    const query = 'location';
    // `getBucketLocation` behaves differently in following ways for
    // different environments.
    //
    // - For nodejs env we default to path style requests.
    // - For browser env path style requests on buckets yields CORS
    //   error. To circumvent this problem we make a virtual host
    //   style request signed with 'us-east-1'. This request fails
    //   with an error 'AuthorizationHeaderMalformed', additionally
    //   the error XML also provides Region of the bucket. To validate
    //   this region is proper we retry the same request with the newly
    //   obtained region.
    const pathStyle = this.pathStyle && !isBrowser;
    let region;
    try {
      const res = await this.makeRequestAsync({
        method,
        bucketName,
        query,
        pathStyle
      }, '', [200], DEFAULT_REGION);
      return extractRegionAsync(res);
    } catch (e) {
      // make alignment with mc cli
      if (e instanceof errors.S3Error) {
        const errCode = e.code;
        const errRegion = e.region;
        if (errCode === 'AccessDenied' && !errRegion) {
          return DEFAULT_REGION;
        }
      }
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (!(e.name === 'AuthorizationHeaderMalformed')) {
        throw e;
      }
      // @ts-expect-error we set extra properties on error object
      region = e.Region;
      if (!region) {
        throw e;
      }
    }
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query,
      pathStyle
    }, '', [200], region);
    return await extractRegionAsync(res);
  }

  /**
   * makeRequest is the primitive used by the apis for making S3 requests.
   * payload can be empty string in case of no payload.
   * statusCode is the expected statusCode. If response.statusCode does not match
   * we parse the XML error and call the callback with the error message.
   * A valid region is passed by the calls - listBuckets, makeBucket and
   * getBucketRegion.
   *
   * @deprecated use `makeRequestAsync` instead
   */
  makeRequest(options, payload = '', expectedCodes = [200], region = '', returnResponse, cb) {
    let prom;
    if (returnResponse) {
      prom = this.makeRequestAsync(options, payload, expectedCodes, region);
    } else {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error compatible for old behaviour
      prom = this.makeRequestAsyncOmit(options, payload, expectedCodes, region);
    }
    prom.then(result => cb(null, result), err => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      cb(err);
    });
  }

  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @deprecated use `makeRequestStreamAsync` instead
   */
  makeRequestStream(options, stream, sha256sum, statusCodes, region, returnResponse, cb) {
    const executor = async () => {
      const res = await this.makeRequestStreamAsync(options, stream, sha256sum, statusCodes, region);
      if (!returnResponse) {
        await drainResponse(res);
      }
      return res;
    };
    executor().then(result => cb(null, result),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    err => cb(err));
  }

  /**
   * @deprecated use `getBucketRegionAsync` instead
   */
  getBucketRegion(bucketName, cb) {
    return this.getBucketRegionAsync(bucketName).then(result => cb(null, result),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    err => cb(err));
  }

  // Bucket operations

  /**
   * Creates the bucket `bucketName`.
   *
   */
  async makeBucket(bucketName, region = '', makeOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    // Backward Compatibility
    if (isObject(region)) {
      makeOpts = region;
      region = '';
    }
    if (!isString(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (makeOpts && !isObject(makeOpts)) {
      throw new TypeError('makeOpts should be of type "object"');
    }
    let payload = '';

    // Region already set in constructor, validate if
    // caller requested bucket location is same.
    if (region && this.region) {
      if (region !== this.region) {
        throw new errors.InvalidArgumentError(`Configured region ${this.region}, requested ${region}`);
      }
    }
    // sending makeBucket request with XML containing 'us-east-1' fails. For
    // default region server expects the request without body
    if (region && region !== DEFAULT_REGION) {
      payload = xml.buildObject({
        CreateBucketConfiguration: {
          $: {
            xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/'
          },
          LocationConstraint: region
        }
      });
    }
    const method = 'PUT';
    const headers = {};
    if (makeOpts && makeOpts.ObjectLocking) {
      headers['x-amz-bucket-object-lock-enabled'] = true;
    }

    // For custom region clients  default to custom region specified in client constructor
    const finalRegion = this.region || region || DEFAULT_REGION;
    const requestOpt = {
      method,
      bucketName,
      headers
    };
    try {
      await this.makeRequestAsyncOmit(requestOpt, payload, [200], finalRegion);
    } catch (err) {
      if (region === '' || region === DEFAULT_REGION) {
        if (err instanceof errors.S3Error) {
          const errCode = err.code;
          const errRegion = err.region;
          if (errCode === 'AuthorizationHeaderMalformed' && errRegion !== '') {
            // Retry with region returned as part of error
            await this.makeRequestAsyncOmit(requestOpt, payload, [200], errCode);
          }
        }
      }
      throw err;
    }
  }

  /**
   * To check if a bucket already exists.
   */
  async bucketExists(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'HEAD';
    try {
      await this.makeRequestAsyncOmit({
        method,
        bucketName
      });
    } catch (err) {
      // @ts-ignore
      if (err.code === 'NoSuchBucket' || err.code === 'NotFound') {
        return false;
      }
      throw err;
    }
    return true;
  }

  /**
   * @deprecated use promise style API
   */

  async removeBucket(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    await this.makeRequestAsyncOmit({
      method,
      bucketName
    }, '', [204]);
    delete this.regionMap[bucketName];
  }

  /**
   * Callback is called with readable stream of the object content.
   */
  async getObject(bucketName, objectName, getOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    return this.getPartialObject(bucketName, objectName, 0, 0, getOpts);
  }

  /**
   * Callback is called with readable stream of the partial object content.
   * @param bucketName
   * @param objectName
   * @param offset
   * @param length - length of the object that will be read in the stream (optional, if not specified we read the rest of the file from the offset)
   * @param getOpts
   */
  async getPartialObject(bucketName, objectName, offset, length = 0, getOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isNumber(offset)) {
      throw new TypeError('offset should be of type "number"');
    }
    if (!isNumber(length)) {
      throw new TypeError('length should be of type "number"');
    }
    let range = '';
    if (offset || length) {
      if (offset) {
        range = `bytes=${+offset}-`;
      } else {
        range = 'bytes=0-';
        offset = 0;
      }
      if (length) {
        range += `${+length + offset - 1}`;
      }
    }
    let query = '';
    let headers = {
      ...(range !== '' && {
        range
      })
    };
    if (getOpts) {
      const sseHeaders = {
        ...(getOpts.SSECustomerAlgorithm && {
          'X-Amz-Server-Side-Encryption-Customer-Algorithm': getOpts.SSECustomerAlgorithm
        }),
        ...(getOpts.SSECustomerKey && {
          'X-Amz-Server-Side-Encryption-Customer-Key': getOpts.SSECustomerKey
        }),
        ...(getOpts.SSECustomerKeyMD5 && {
          'X-Amz-Server-Side-Encryption-Customer-Key-MD5': getOpts.SSECustomerKeyMD5
        })
      };
      query = qs.stringify(getOpts);
      headers = {
        ...prependXAMZMeta(sseHeaders),
        ...headers
      };
    }
    const expectedStatusCodes = [200];
    if (range) {
      expectedStatusCodes.push(206);
    }
    const method = 'GET';
    return await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      headers,
      query
    }, '', expectedStatusCodes);
  }

  /**
   * download object content to a file.
   * This method will create a temp file named `${filename}.${base64(etag)}.part.minio` when downloading.
   *
   * @param bucketName - name of the bucket
   * @param objectName - name of the object
   * @param filePath - path to which the object data will be written to
   * @param getOpts - Optional object get option
   */
  async fGetObject(bucketName, objectName, filePath, getOpts) {
    // Input validation.
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    const downloadToTmpFile = async () => {
      let partFileStream;
      const objStat = await this.statObject(bucketName, objectName, getOpts);
      const encodedEtag = Buffer.from(objStat.etag).toString('base64');
      const partFile = `${filePath}.${encodedEtag}.part.minio`;
      await fsp.mkdir(path.dirname(filePath), {
        recursive: true
      });
      let offset = 0;
      try {
        const stats = await fsp.stat(partFile);
        if (objStat.size === stats.size) {
          return partFile;
        }
        offset = stats.size;
        partFileStream = fs.createWriteStream(partFile, {
          flags: 'a'
        });
      } catch (e) {
        if (e instanceof Error && e.code === 'ENOENT') {
          // file not exist
          partFileStream = fs.createWriteStream(partFile, {
            flags: 'w'
          });
        } else {
          // other error, maybe access deny
          throw e;
        }
      }
      const downloadStream = await this.getPartialObject(bucketName, objectName, offset, 0, getOpts);
      await streamPromise.pipeline(downloadStream, partFileStream);
      const stats = await fsp.stat(partFile);
      if (stats.size === objStat.size) {
        return partFile;
      }
      throw new Error('Size mismatch between downloaded file and the object');
    };
    const partFile = await downloadToTmpFile();
    await fsp.rename(partFile, filePath);
  }

  /**
   * Stat information of the object.
   */
  async statObject(bucketName, objectName, statOpts) {
    const statOptDef = statOpts || {};
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(statOptDef)) {
      throw new errors.InvalidArgumentError('statOpts should be of type "object"');
    }
    const query = qs.stringify(statOptDef);
    const method = 'HEAD';
    const res = await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query
    });
    return {
      size: parseInt(res.headers['content-length']),
      metaData: extractMetadata(res.headers),
      lastModified: new Date(res.headers['last-modified']),
      versionId: getVersionId(res.headers),
      etag: sanitizeETag(res.headers.etag)
    };
  }
  async removeObject(bucketName, objectName, removeOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (removeOpts && !isObject(removeOpts)) {
      throw new errors.InvalidArgumentError('removeOpts should be of type "object"');
    }
    const method = 'DELETE';
    const headers = {};
    if (removeOpts !== null && removeOpts !== void 0 && removeOpts.governanceBypass) {
      headers['X-Amz-Bypass-Governance-Retention'] = true;
    }
    if (removeOpts !== null && removeOpts !== void 0 && removeOpts.forceDelete) {
      headers['x-minio-force-delete'] = true;
    }
    const queryParams = {};
    if (removeOpts !== null && removeOpts !== void 0 && removeOpts.versionId) {
      queryParams.versionId = `${removeOpts.versionId}`;
    }
    const query = qs.stringify(queryParams);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      headers,
      query
    }, '', [200, 204]);
  }

  // Calls implemented below are related to multipart.

  listIncompleteUploads(bucket, prefix, recursive) {
    if (prefix === undefined) {
      prefix = '';
    }
    if (recursive === undefined) {
      recursive = false;
    }
    if (!isValidBucketName(bucket)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucket);
    }
    if (!isValidPrefix(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!isBoolean(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    const delimiter = recursive ? '' : '/';
    let keyMarker = '';
    let uploadIdMarker = '';
    const uploads = [];
    let ended = false;

    // TODO: refactor this with async/await and `stream.Readable.from`
    const readStream = new stream.Readable({
      objectMode: true
    });
    readStream._read = () => {
      // push one upload info per _read()
      if (uploads.length) {
        return readStream.push(uploads.shift());
      }
      if (ended) {
        return readStream.push(null);
      }
      this.listIncompleteUploadsQuery(bucket, prefix, keyMarker, uploadIdMarker, delimiter).then(result => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        result.prefixes.forEach(prefix => uploads.push(prefix));
        async.eachSeries(result.uploads, (upload, cb) => {
          // for each incomplete upload add the sizes of its uploaded parts
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          this.listParts(bucket, upload.key, upload.uploadId).then(parts => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            upload.size = parts.reduce((acc, item) => acc + item.size, 0);
            uploads.push(upload);
            cb();
          }, err => cb(err));
        }, err => {
          if (err) {
            readStream.emit('error', err);
            return;
          }
          if (result.isTruncated) {
            keyMarker = result.nextKeyMarker;
            uploadIdMarker = result.nextUploadIdMarker;
          } else {
            ended = true;
          }

          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          readStream._read();
        });
      }, e => {
        readStream.emit('error', e);
      });
    };
    return readStream;
  }

  /**
   * Called by listIncompleteUploads to fetch a batch of incomplete uploads.
   */
  async listIncompleteUploadsQuery(bucketName, prefix, keyMarker, uploadIdMarker, delimiter) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isString(keyMarker)) {
      throw new TypeError('keyMarker should be of type "string"');
    }
    if (!isString(uploadIdMarker)) {
      throw new TypeError('uploadIdMarker should be of type "string"');
    }
    if (!isString(delimiter)) {
      throw new TypeError('delimiter should be of type "string"');
    }
    const queries = [];
    queries.push(`prefix=${uriEscape(prefix)}`);
    queries.push(`delimiter=${uriEscape(delimiter)}`);
    if (keyMarker) {
      queries.push(`key-marker=${uriEscape(keyMarker)}`);
    }
    if (uploadIdMarker) {
      queries.push(`upload-id-marker=${uploadIdMarker}`);
    }
    const maxUploads = 1000;
    queries.push(`max-uploads=${maxUploads}`);
    queries.sort();
    queries.unshift('uploads');
    let query = '';
    if (queries.length > 0) {
      query = `${queries.join('&')}`;
    }
    const method = 'GET';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await readAsString(res);
    return xmlParsers.parseListMultipart(body);
  }

  /**
   * Initiate a new multipart upload.
   * @internal
   */
  async initiateNewMultipartUpload(bucketName, objectName, headers) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(headers)) {
      throw new errors.InvalidObjectNameError('contentType should be of type "object"');
    }
    const method = 'POST';
    const query = 'uploads';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query,
      headers
    });
    const body = await readAsBuffer(res);
    return parseInitiateMultipart(body.toString());
  }

  /**
   * Internal Method to abort a multipart upload request in case of any errors.
   *
   * @param bucketName - Bucket Name
   * @param objectName - Object Name
   * @param uploadId - id of a multipart upload to cancel during compose object sequence.
   */
  async abortMultipartUpload(bucketName, objectName, uploadId) {
    const method = 'DELETE';
    const query = `uploadId=${uploadId}`;
    const requestOptions = {
      method,
      bucketName,
      objectName: objectName,
      query
    };
    await this.makeRequestAsyncOmit(requestOptions, '', [204]);
  }
  async findUploadId(bucketName, objectName) {
    var _latestUpload;
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    let latestUpload;
    let keyMarker = '';
    let uploadIdMarker = '';
    for (;;) {
      const result = await this.listIncompleteUploadsQuery(bucketName, objectName, keyMarker, uploadIdMarker, '');
      for (const upload of result.uploads) {
        if (upload.key === objectName) {
          if (!latestUpload || upload.initiated.getTime() > latestUpload.initiated.getTime()) {
            latestUpload = upload;
          }
        }
      }
      if (result.isTruncated) {
        keyMarker = result.nextKeyMarker;
        uploadIdMarker = result.nextUploadIdMarker;
        continue;
      }
      break;
    }
    return (_latestUpload = latestUpload) === null || _latestUpload === void 0 ? void 0 : _latestUpload.uploadId;
  }

  /**
   * this call will aggregate the parts on the server into a single object.
   */
  async completeMultipartUpload(bucketName, objectName, uploadId, etags) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!isObject(etags)) {
      throw new TypeError('etags should be of type "Array"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    const method = 'POST';
    const query = `uploadId=${uriEscape(uploadId)}`;
    const builder = new xml2js.Builder();
    const payload = builder.buildObject({
      CompleteMultipartUpload: {
        $: {
          xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/'
        },
        Part: etags.map(etag => {
          return {
            PartNumber: etag.part,
            ETag: etag.etag
          };
        })
      }
    });
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    }, payload);
    const body = await readAsBuffer(res);
    const result = parseCompleteMultipart(body.toString());
    if (!result) {
      throw new Error('BUG: failed to parse server response');
    }
    if (result.errCode) {
      // Multipart Complete API returns an error XML after a 200 http status
      throw new errors.S3Error(result.errMessage);
    }
    return {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      etag: result.etag,
      versionId: getVersionId(res.headers)
    };
  }

  /**
   * Get part-info of all parts of an incomplete upload specified by uploadId.
   */
  async listParts(bucketName, objectName, uploadId) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    const parts = [];
    let marker = 0;
    let result;
    do {
      result = await this.listPartsQuery(bucketName, objectName, uploadId, marker);
      marker = result.marker;
      parts.push(...result.parts);
    } while (result.isTruncated);
    return parts;
  }

  /**
   * Called by listParts to fetch a batch of part-info
   */
  async listPartsQuery(bucketName, objectName, uploadId, marker) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!isNumber(marker)) {
      throw new TypeError('marker should be of type "number"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    let query = `uploadId=${uriEscape(uploadId)}`;
    if (marker) {
      query += `&part-number-marker=${marker}`;
    }
    const method = 'GET';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    });
    return xmlParsers.parseListParts(await readAsString(res));
  }
  async listBuckets() {
    const method = 'GET';
    const regionConf = this.region || DEFAULT_REGION;
    const httpRes = await this.makeRequestAsync({
      method
    }, '', [200], regionConf);
    const xmlResult = await readAsString(httpRes);
    return xmlParsers.parseListBucket(xmlResult);
  }

  /**
   * Calculate part size given the object size. Part size will be atleast this.partSize
   */
  calculatePartSize(size) {
    if (!isNumber(size)) {
      throw new TypeError('size should be of type "number"');
    }
    if (size > this.maxObjectSize) {
      throw new TypeError(`size should not be more than ${this.maxObjectSize}`);
    }
    if (this.overRidePartSize) {
      return this.partSize;
    }
    let partSize = this.partSize;
    for (;;) {
      // while(true) {...} throws linting error.
      // If partSize is big enough to accomodate the object size, then use it.
      if (partSize * 10000 > size) {
        return partSize;
      }
      // Try part sizes as 64MB, 80MB, 96MB etc.
      partSize += 16 * 1024 * 1024;
    }
  }

  /**
   * Uploads the object using contents from a file
   */
  async fPutObject(bucketName, objectName, filePath, metaData) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    if (metaData && !isObject(metaData)) {
      throw new TypeError('metaData should be of type "object"');
    }

    // Inserts correct `content-type` attribute based on metaData and filePath
    metaData = insertContentType(metaData || {}, filePath);
    const stat = await fsp.lstat(filePath);
    return await this.putObject(bucketName, objectName, fs.createReadStream(filePath), stat.size, metaData);
  }

  /**
   *  Uploading a stream, "Buffer" or "string".
   *  It's recommended to pass `size` argument with stream.
   */
  async putObject(bucketName, objectName, stream, size, metaData) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }

    // We'll need to shift arguments to the left because of metaData
    // and size being optional.
    if (isObject(size)) {
      metaData = size;
    }
    // Ensures Metadata has appropriate prefix for A3 API
    const headers = prependXAMZMeta(metaData);
    if (typeof stream === 'string' || stream instanceof Buffer) {
      // Adapts the non-stream interface into a stream.
      size = stream.length;
      stream = readableStream(stream);
    } else if (!isReadableStream(stream)) {
      throw new TypeError('third argument should be of type "stream.Readable" or "Buffer" or "string"');
    }
    if (isNumber(size) && size < 0) {
      throw new errors.InvalidArgumentError(`size cannot be negative, given size: ${size}`);
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (!isNumber(size)) {
      size = this.maxObjectSize;
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (size === undefined) {
      const statSize = await getContentLength(stream);
      if (statSize !== null) {
        size = statSize;
      }
    }
    if (!isNumber(size)) {
      // Backward compatibility
      size = this.maxObjectSize;
    }
    const partSize = this.calculatePartSize(size);
    if (typeof stream === 'string' || stream.readableLength === 0 || Buffer.isBuffer(stream) || size <= partSize) {
      const buf = isReadableStream(stream) ? await readAsBuffer(stream) : Buffer.from(stream);
      return this.uploadBuffer(bucketName, objectName, headers, buf);
    }
    return this.uploadStream(bucketName, objectName, headers, stream, partSize);
  }

  /**
   * method to upload buffer in one call
   * @private
   */
  async uploadBuffer(bucketName, objectName, headers, buf) {
    const {
      md5sum,
      sha256sum
    } = hashBinary(buf, this.enableSHA256);
    headers['Content-Length'] = buf.length;
    if (!this.enableSHA256) {
      headers['Content-MD5'] = md5sum;
    }
    const res = await this.makeRequestStreamAsync({
      method: 'PUT',
      bucketName,
      objectName,
      headers
    }, buf, sha256sum, [200], '');
    await drainResponse(res);
    return {
      etag: sanitizeETag(res.headers.etag),
      versionId: getVersionId(res.headers)
    };
  }

  /**
   * upload stream with MultipartUpload
   * @private
   */
  async uploadStream(bucketName, objectName, headers, body, partSize) {
    // A map of the previously uploaded chunks, for resuming a file upload. This
    // will be null if we aren't resuming an upload.
    const oldParts = {};

    // Keep track of the etags for aggregating the chunks together later. Each
    // etag represents a single chunk of the file.
    const eTags = [];
    const previousUploadId = await this.findUploadId(bucketName, objectName);
    let uploadId;
    if (!previousUploadId) {
      uploadId = await this.initiateNewMultipartUpload(bucketName, objectName, headers);
    } else {
      uploadId = previousUploadId;
      const oldTags = await this.listParts(bucketName, objectName, previousUploadId);
      oldTags.forEach(e => {
        oldParts[e.part] = e;
      });
    }
    const chunkier = new BlockStream2({
      size: partSize,
      zeroPadding: false
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_, o] = await Promise.all([new Promise((resolve, reject) => {
      body.pipe(chunkier).on('error', reject);
      chunkier.on('end', resolve).on('error', reject);
    }), (async () => {
      let partNumber = 1;
      for await (const chunk of chunkier) {
        const md5 = crypto.createHash('md5').update(chunk).digest();
        const oldPart = oldParts[partNumber];
        if (oldPart) {
          if (oldPart.etag === md5.toString('hex')) {
            eTags.push({
              part: partNumber,
              etag: oldPart.etag
            });
            partNumber++;
            continue;
          }
        }
        partNumber++;

        // now start to upload missing part
        const options = {
          method: 'PUT',
          query: qs.stringify({
            partNumber,
            uploadId
          }),
          headers: {
            'Content-Length': chunk.length,
            'Content-MD5': md5.toString('base64')
          },
          bucketName,
          objectName
        };
        const response = await this.makeRequestAsyncOmit(options, chunk);
        let etag = response.headers.etag;
        if (etag) {
          etag = etag.replace(/^"/, '').replace(/"$/, '');
        } else {
          etag = '';
        }
        eTags.push({
          part: partNumber,
          etag
        });
      }
      return await this.completeMultipartUpload(bucketName, objectName, uploadId, eTags);
    })()]);
    return o;
  }
  async removeBucketReplication(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    const query = 'replication';
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, '', [200, 204], '');
  }
  async setBucketReplication(bucketName, replicationConfig) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isObject(replicationConfig)) {
      throw new errors.InvalidArgumentError('replicationConfig should be of type "object"');
    } else {
      if (_.isEmpty(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Role cannot be empty');
      } else if (replicationConfig.role && !isString(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Invalid value for role', replicationConfig.role);
      }
      if (_.isEmpty(replicationConfig.rules)) {
        throw new errors.InvalidArgumentError('Minimum one replication rule must be specified');
      }
    }
    const method = 'PUT';
    const query = 'replication';
    const headers = {};
    const replicationParamsConfig = {
      ReplicationConfiguration: {
        Role: replicationConfig.role,
        Rule: replicationConfig.rules
      }
    };
    const builder = new xml2js.Builder({
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(replicationParamsConfig);
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketReplication(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'replication';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    }, '', [200, 204]);
    const xmlResult = await readAsString(httpRes);
    return xmlParsers.parseReplicationConfig(xmlResult);
  }
  async getObjectLegalHold(bucketName, objectName, getOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (getOpts) {
      if (!isObject(getOpts)) {
        throw new TypeError('getOpts should be of type "Object"');
      } else if (Object.keys(getOpts).length > 0 && getOpts.versionId && !isString(getOpts.versionId)) {
        throw new TypeError('versionId should be of type string.:', getOpts.versionId);
      }
    }
    const method = 'GET';
    let query = 'legal-hold';
    if (getOpts !== null && getOpts !== void 0 && getOpts.versionId) {
      query += `&versionId=${getOpts.versionId}`;
    }
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    }, '', [200]);
    const strRes = await readAsString(httpRes);
    return parseObjectLegalHoldConfig(strRes);
  }
  async setObjectLegalHold(bucketName, objectName, setOpts = {
    status: LEGAL_HOLD_STATUS.ENABLED
  }) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(setOpts)) {
      throw new TypeError('setOpts should be of type "Object"');
    } else {
      if (![LEGAL_HOLD_STATUS.ENABLED, LEGAL_HOLD_STATUS.DISABLED].includes(setOpts === null || setOpts === void 0 ? void 0 : setOpts.status)) {
        throw new TypeError('Invalid status: ' + setOpts.status);
      }
      if (setOpts.versionId && !setOpts.versionId.length) {
        throw new TypeError('versionId should be of type string.:' + setOpts.versionId);
      }
    }
    const method = 'PUT';
    let query = 'legal-hold';
    if (setOpts.versionId) {
      query += `&versionId=${setOpts.versionId}`;
    }
    const config = {
      Status: setOpts.status
    };
    const builder = new xml2js.Builder({
      rootName: 'LegalHold',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query,
      headers
    }, payload);
  }

  /**
   * Get Tags associated with a Bucket
   */
  async getBucketTagging(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    const method = 'GET';
    const query = 'tagging';
    const requestOptions = {
      method,
      bucketName,
      query
    };
    const response = await this.makeRequestAsync(requestOptions);
    const body = await readAsString(response);
    return xmlParsers.parseTagging(body);
  }

  /**
   *  Get the tags associated with a bucket OR an object
   */
  async getObjectTagging(bucketName, objectName, getOpts) {
    const method = 'GET';
    let query = 'tagging';
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (getOpts && !isObject(getOpts)) {
      throw new errors.InvalidArgumentError('getOpts should be of type "object"');
    }
    if (getOpts && getOpts.versionId) {
      query = `${query}&versionId=${getOpts.versionId}`;
    }
    const requestOptions = {
      method,
      bucketName,
      query
    };
    if (objectName) {
      requestOptions['objectName'] = objectName;
    }
    const response = await this.makeRequestAsync(requestOptions);
    const body = await readAsString(response);
    return xmlParsers.parseTagging(body);
  }

  /**
   *  Set the policy on a bucket or an object prefix.
   */
  async setBucketPolicy(bucketName, policy) {
    // Validate arguments.
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isString(policy)) {
      throw new errors.InvalidBucketPolicyError(`Invalid bucket policy: ${policy} - must be "string"`);
    }
    const query = 'policy';
    let method = 'DELETE';
    if (policy) {
      method = 'PUT';
    }
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, policy, [204], '');
  }

  /**
   * Get the policy on a bucket or an object prefix.
   */
  async getBucketPolicy(bucketName) {
    // Validate arguments.
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    const method = 'GET';
    const query = 'policy';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    return await readAsString(res);
  }
  async putObjectRetention(bucketName, objectName, retentionOpts = {}) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(retentionOpts)) {
      throw new errors.InvalidArgumentError('retentionOpts should be of type "object"');
    } else {
      if (retentionOpts.governanceBypass && !isBoolean(retentionOpts.governanceBypass)) {
        throw new errors.InvalidArgumentError(`Invalid value for governanceBypass: ${retentionOpts.governanceBypass}`);
      }
      if (retentionOpts.mode && ![RETENTION_MODES.COMPLIANCE, RETENTION_MODES.GOVERNANCE].includes(retentionOpts.mode)) {
        throw new errors.InvalidArgumentError(`Invalid object retention mode: ${retentionOpts.mode}`);
      }
      if (retentionOpts.retainUntilDate && !isString(retentionOpts.retainUntilDate)) {
        throw new errors.InvalidArgumentError(`Invalid value for retainUntilDate: ${retentionOpts.retainUntilDate}`);
      }
      if (retentionOpts.versionId && !isString(retentionOpts.versionId)) {
        throw new errors.InvalidArgumentError(`Invalid value for versionId: ${retentionOpts.versionId}`);
      }
    }
    const method = 'PUT';
    let query = 'retention';
    const headers = {};
    if (retentionOpts.governanceBypass) {
      headers['X-Amz-Bypass-Governance-Retention'] = true;
    }
    const builder = new xml2js.Builder({
      rootName: 'Retention',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const params = {};
    if (retentionOpts.mode) {
      params.Mode = retentionOpts.mode;
    }
    if (retentionOpts.retainUntilDate) {
      params.RetainUntilDate = retentionOpts.retainUntilDate;
    }
    if (retentionOpts.versionId) {
      query += `&versionId=${retentionOpts.versionId}`;
    }
    const payload = builder.buildObject(params);
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query,
      headers
    }, payload, [200, 204]);
  }
  async getObjectLockConfig(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'object-lock';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const xmlResult = await readAsString(httpRes);
    return xmlParsers.parseObjectLockConfig(xmlResult);
  }
  async setObjectLockConfig(bucketName, lockConfigOpts) {
    const retentionModes = [RETENTION_MODES.COMPLIANCE, RETENTION_MODES.GOVERNANCE];
    const validUnits = [RETENTION_VALIDITY_UNITS.DAYS, RETENTION_VALIDITY_UNITS.YEARS];
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (lockConfigOpts.mode && !retentionModes.includes(lockConfigOpts.mode)) {
      throw new TypeError(`lockConfigOpts.mode should be one of ${retentionModes}`);
    }
    if (lockConfigOpts.unit && !validUnits.includes(lockConfigOpts.unit)) {
      throw new TypeError(`lockConfigOpts.unit should be one of ${validUnits}`);
    }
    if (lockConfigOpts.validity && !isNumber(lockConfigOpts.validity)) {
      throw new TypeError(`lockConfigOpts.validity should be a number`);
    }
    const method = 'PUT';
    const query = 'object-lock';
    const config = {
      ObjectLockEnabled: 'Enabled'
    };
    const configKeys = Object.keys(lockConfigOpts);
    const isAllKeysSet = ['unit', 'mode', 'validity'].every(lck => configKeys.includes(lck));
    // Check if keys are present and all keys are present.
    if (configKeys.length > 0) {
      if (!isAllKeysSet) {
        throw new TypeError(`lockConfigOpts.mode,lockConfigOpts.unit,lockConfigOpts.validity all the properties should be specified.`);
      } else {
        config.Rule = {
          DefaultRetention: {}
        };
        if (lockConfigOpts.mode) {
          config.Rule.DefaultRetention.Mode = lockConfigOpts.mode;
        }
        if (lockConfigOpts.unit === RETENTION_VALIDITY_UNITS.DAYS) {
          config.Rule.DefaultRetention.Days = lockConfigOpts.validity;
        } else if (lockConfigOpts.unit === RETENTION_VALIDITY_UNITS.YEARS) {
          config.Rule.DefaultRetention.Years = lockConfigOpts.validity;
        }
      }
    }
    const builder = new xml2js.Builder({
      rootName: 'ObjectLockConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketVersioning(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'versioning';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const xmlResult = await readAsString(httpRes);
    return await xmlParsers.parseBucketVersioningConfig(xmlResult);
  }
  async setBucketVersioning(bucketName, versionConfig) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Object.keys(versionConfig).length) {
      throw new errors.InvalidArgumentError('versionConfig should be of type "object"');
    }
    const method = 'PUT';
    const query = 'versioning';
    const builder = new xml2js.Builder({
      rootName: 'VersioningConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(versionConfig);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, payload);
  }
  async setTagging(taggingParams) {
    const {
      bucketName,
      objectName,
      tags,
      putOpts
    } = taggingParams;
    const method = 'PUT';
    let query = 'tagging';
    if (putOpts && putOpts !== null && putOpts !== void 0 && putOpts.versionId) {
      query = `${query}&versionId=${putOpts.versionId}`;
    }
    const tagsList = [];
    for (const [key, value] of Object.entries(tags)) {
      tagsList.push({
        Key: key,
        Value: value
      });
    }
    const taggingConfig = {
      Tagging: {
        TagSet: {
          Tag: tagsList
        }
      }
    };
    const headers = {};
    const builder = new xml2js.Builder({
      headless: true,
      renderOpts: {
        pretty: false
      }
    });
    const payloadBuf = Buffer.from(builder.buildObject(taggingConfig));
    const requestOptions = {
      method,
      bucketName,
      query,
      headers,
      ...(objectName && {
        objectName: objectName
      })
    };
    headers['Content-MD5'] = toMd5(payloadBuf);
    await this.makeRequestAsyncOmit(requestOptions, payloadBuf);
  }
  async removeTagging({
    bucketName,
    objectName,
    removeOpts
  }) {
    const method = 'DELETE';
    let query = 'tagging';
    if (removeOpts && Object.keys(removeOpts).length && removeOpts.versionId) {
      query = `${query}&versionId=${removeOpts.versionId}`;
    }
    const requestOptions = {
      method,
      bucketName,
      objectName,
      query
    };
    if (objectName) {
      requestOptions['objectName'] = objectName;
    }
    await this.makeRequestAsync(requestOptions, '', [200, 204]);
  }
  async setBucketTagging(bucketName, tags) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isObject(tags)) {
      throw new errors.InvalidArgumentError('tags should be of type "object"');
    }
    if (Object.keys(tags).length > 10) {
      throw new errors.InvalidArgumentError('maximum tags allowed is 10"');
    }
    await this.setTagging({
      bucketName,
      tags
    });
  }
  async removeBucketTagging(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    await this.removeTagging({
      bucketName
    });
  }
  async setObjectTagging(bucketName, objectName, tags, putOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (!isObject(tags)) {
      throw new errors.InvalidArgumentError('tags should be of type "object"');
    }
    if (Object.keys(tags).length > 10) {
      throw new errors.InvalidArgumentError('Maximum tags allowed is 10"');
    }
    await this.setTagging({
      bucketName,
      objectName,
      tags,
      putOpts
    });
  }
  async removeObjectTagging(bucketName, objectName, removeOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (removeOpts && Object.keys(removeOpts).length && !isObject(removeOpts)) {
      throw new errors.InvalidArgumentError('removeOpts should be of type "object"');
    }
    await this.removeTagging({
      bucketName,
      objectName,
      removeOpts
    });
  }
  async selectObjectContent(bucketName, objectName, selectOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!_.isEmpty(selectOpts)) {
      if (!isString(selectOpts.expression)) {
        throw new TypeError('sqlExpression should be of type "string"');
      }
      if (!_.isEmpty(selectOpts.inputSerialization)) {
        if (!isObject(selectOpts.inputSerialization)) {
          throw new TypeError('inputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('inputSerialization is required');
      }
      if (!_.isEmpty(selectOpts.outputSerialization)) {
        if (!isObject(selectOpts.outputSerialization)) {
          throw new TypeError('outputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('outputSerialization is required');
      }
    } else {
      throw new TypeError('valid select configuration is required');
    }
    const method = 'POST';
    const query = `select&select-type=2`;
    const config = [{
      Expression: selectOpts.expression
    }, {
      ExpressionType: selectOpts.expressionType || 'SQL'
    }, {
      InputSerialization: [selectOpts.inputSerialization]
    }, {
      OutputSerialization: [selectOpts.outputSerialization]
    }];

    // Optional
    if (selectOpts.requestProgress) {
      config.push({
        RequestProgress: selectOpts === null || selectOpts === void 0 ? void 0 : selectOpts.requestProgress
      });
    }
    // Optional
    if (selectOpts.scanRange) {
      config.push({
        ScanRange: selectOpts.scanRange
      });
    }
    const builder = new xml2js.Builder({
      rootName: 'SelectObjectContentRequest',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    }, payload);
    const body = await readAsBuffer(res);
    return parseSelectObjectContentResponse(body);
  }
  async applyBucketLifecycle(bucketName, policyConfig) {
    const method = 'PUT';
    const query = 'lifecycle';
    const headers = {};
    const builder = new xml2js.Builder({
      rootName: 'LifecycleConfiguration',
      headless: true,
      renderOpts: {
        pretty: false
      }
    });
    const payload = builder.buildObject(policyConfig);
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async removeBucketLifecycle(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    const query = 'lifecycle';
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, '', [204]);
  }
  async setBucketLifecycle(bucketName, lifeCycleConfig) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (_.isEmpty(lifeCycleConfig)) {
      await this.removeBucketLifecycle(bucketName);
    } else {
      await this.applyBucketLifecycle(bucketName, lifeCycleConfig);
    }
  }
  async getBucketLifecycle(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'lifecycle';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await readAsString(res);
    return xmlParsers.parseLifecycleConfig(body);
  }
  async setBucketEncryption(bucketName, encryptionConfig) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!_.isEmpty(encryptionConfig) && encryptionConfig.Rule.length > 1) {
      throw new errors.InvalidArgumentError('Invalid Rule length. Only one rule is allowed.: ' + encryptionConfig.Rule);
    }
    let encryptionObj = encryptionConfig;
    if (_.isEmpty(encryptionConfig)) {
      encryptionObj = {
        // Default MinIO Server Supported Rule
        Rule: [{
          ApplyServerSideEncryptionByDefault: {
            SSEAlgorithm: 'AES256'
          }
        }]
      };
    }
    const method = 'PUT';
    const query = 'encryption';
    const builder = new xml2js.Builder({
      rootName: 'ServerSideEncryptionConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(encryptionObj);
    const headers = {};
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketEncryption(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'encryption';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await readAsString(res);
    return xmlParsers.parseBucketEncryptionConfig(body);
  }
  async removeBucketEncryption(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    const query = 'encryption';
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, '', [204]);
  }
  async getObjectRetention(bucketName, objectName, getOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (getOpts && !isObject(getOpts)) {
      throw new errors.InvalidArgumentError('getOpts should be of type "object"');
    } else if (getOpts !== null && getOpts !== void 0 && getOpts.versionId && !isString(getOpts.versionId)) {
      throw new errors.InvalidArgumentError('versionId should be of type "string"');
    }
    const method = 'GET';
    let query = 'retention';
    if (getOpts !== null && getOpts !== void 0 && getOpts.versionId) {
      query += `&versionId=${getOpts.versionId}`;
    }
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    });
    const body = await readAsString(res);
    return xmlParsers.parseObjectRetentionConfig(body);
  }
  async removeObjects(bucketName, objectsList) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Array.isArray(objectsList)) {
      throw new errors.InvalidArgumentError('objectsList should be a list');
    }
    const runDeleteObjects = async batch => {
      const delObjects = batch.map(value => {
        return isObject(value) ? {
          Key: value.name,
          VersionId: value.versionId
        } : {
          Key: value
        };
      });
      const remObjects = {
        Delete: {
          Quiet: true,
          Object: delObjects
        }
      };
      const payload = Buffer.from(new xml2js.Builder({
        headless: true
      }).buildObject(remObjects));
      const headers = {
        'Content-MD5': toMd5(payload)
      };
      const res = await this.makeRequestAsync({
        method: 'POST',
        bucketName,
        query: 'delete',
        headers
      }, payload);
      const body = await readAsString(res);
      return xmlParsers.removeObjectsParser(body);
    };
    const maxEntries = 1000; // max entries accepted in server for DeleteMultipleObjects API.
    // Client side batching
    const batches = [];
    for (let i = 0; i < objectsList.length; i += maxEntries) {
      batches.push(objectsList.slice(i, i + maxEntries));
    }
    const batchResults = await Promise.all(batches.map(runDeleteObjects));
    return batchResults.flat();
  }
  async removeIncompleteUpload(bucketName, objectName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.IsValidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    const removeUploadId = await this.findUploadId(bucketName, objectName);
    const method = 'DELETE';
    const query = `uploadId=${removeUploadId}`;
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query
    }, '', [204]);
  }
  async copyObjectV1(targetBucketName, targetObjectName, sourceBucketNameAndObjectName, conditions) {
    if (typeof conditions == 'function') {
      conditions = null;
    }
    if (!isValidBucketName(targetBucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + targetBucketName);
    }
    if (!isValidObjectName(targetObjectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${targetObjectName}`);
    }
    if (!isString(sourceBucketNameAndObjectName)) {
      throw new TypeError('sourceBucketNameAndObjectName should be of type "string"');
    }
    if (sourceBucketNameAndObjectName === '') {
      throw new errors.InvalidPrefixError(`Empty source prefix`);
    }
    if (conditions != null && !(conditions instanceof CopyConditions)) {
      throw new TypeError('conditions should be of type "CopyConditions"');
    }
    const headers = {};
    headers['x-amz-copy-source'] = uriResourceEscape(sourceBucketNameAndObjectName);
    if (conditions) {
      if (conditions.modified !== '') {
        headers['x-amz-copy-source-if-modified-since'] = conditions.modified;
      }
      if (conditions.unmodified !== '') {
        headers['x-amz-copy-source-if-unmodified-since'] = conditions.unmodified;
      }
      if (conditions.matchETag !== '') {
        headers['x-amz-copy-source-if-match'] = conditions.matchETag;
      }
      if (conditions.matchETagExcept !== '') {
        headers['x-amz-copy-source-if-none-match'] = conditions.matchETagExcept;
      }
    }
    const method = 'PUT';
    const res = await this.makeRequestAsync({
      method,
      bucketName: targetBucketName,
      objectName: targetObjectName,
      headers
    });
    const body = await readAsString(res);
    return xmlParsers.parseCopyObject(body);
  }
  async copyObjectV2(sourceConfig, destConfig) {
    if (!(sourceConfig instanceof CopySourceOptions)) {
      throw new errors.InvalidArgumentError('sourceConfig should of type CopySourceOptions ');
    }
    if (!(destConfig instanceof CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (!destConfig.validate()) {
      return Promise.reject();
    }
    if (!destConfig.validate()) {
      return Promise.reject();
    }
    const headers = Object.assign({}, sourceConfig.getHeaders(), destConfig.getHeaders());
    const bucketName = destConfig.Bucket;
    const objectName = destConfig.Object;
    const method = 'PUT';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      headers
    });
    const body = await readAsString(res);
    const copyRes = xmlParsers.parseCopyObject(body);
    const resHeaders = res.headers;
    const sizeHeaderValue = resHeaders && resHeaders['content-length'];
    const size = typeof sizeHeaderValue === 'number' ? sizeHeaderValue : undefined;
    return {
      Bucket: destConfig.Bucket,
      Key: destConfig.Object,
      LastModified: copyRes.lastModified,
      MetaData: extractMetadata(resHeaders),
      VersionId: getVersionId(resHeaders),
      SourceVersionId: getSourceVersionId(resHeaders),
      Etag: sanitizeETag(resHeaders.etag),
      Size: size
    };
  }
  async copyObject(...allArgs) {
    if (typeof allArgs[0] === 'string') {
      const [targetBucketName, targetObjectName, sourceBucketNameAndObjectName, conditions] = allArgs;
      return await this.copyObjectV1(targetBucketName, targetObjectName, sourceBucketNameAndObjectName, conditions);
    }
    const [source, dest] = allArgs;
    return await this.copyObjectV2(source, dest);
  }
  async uploadPart(partConfig, payload) {
    const {
      bucketName,
      objectName,
      uploadID,
      partNumber,
      headers
    } = partConfig;
    const method = 'PUT';
    const query = `uploadId=${uploadID}&partNumber=${partNumber}`;
    const requestOptions = {
      method,
      bucketName,
      objectName: objectName,
      query,
      headers
    };
    const res = await this.makeRequestAsync(requestOptions, payload);
    const body = await readAsString(res);
    const partRes = uploadPartParser(body);
    return {
      etag: sanitizeETag(partRes.ETag),
      key: objectName,
      part: partNumber
    };
  }
  async composeObject(destObjConfig, sourceObjList) {
    const sourceFilesLength = sourceObjList.length;
    if (!Array.isArray(sourceObjList)) {
      throw new errors.InvalidArgumentError('sourceConfig should an array of CopySourceOptions ');
    }
    if (!(destObjConfig instanceof CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (sourceFilesLength < 1 || sourceFilesLength > PART_CONSTRAINTS.MAX_PARTS_COUNT) {
      throw new errors.InvalidArgumentError(`"There must be as least one and up to ${PART_CONSTRAINTS.MAX_PARTS_COUNT} source objects.`);
    }
    for (let i = 0; i < sourceFilesLength; i++) {
      const sObj = sourceObjList[i];
      if (!sObj.validate()) {
        return false;
      }
    }
    if (!destObjConfig.validate()) {
      return false;
    }
    const getStatOptions = srcConfig => {
      let statOpts = {};
      if (!_.isEmpty(srcConfig.VersionID)) {
        statOpts = {
          versionId: srcConfig.VersionID
        };
      }
      return statOpts;
    };
    const srcObjectSizes = [];
    let totalSize = 0;
    let totalParts = 0;
    const sourceObjStats = sourceObjList.map(srcItem => this.statObject(srcItem.Bucket, srcItem.Object, getStatOptions(srcItem)));
    const srcObjectInfos = await Promise.all(sourceObjStats);
    const validatedStats = srcObjectInfos.map((resItemStat, index) => {
      const srcConfig = sourceObjList[index];
      let srcCopySize = resItemStat.size;
      // Check if a segment is specified, and if so, is the
      // segment within object bounds?
      if (srcConfig && srcConfig.MatchRange) {
        // Since range is specified,
        //    0 <= src.srcStart <= src.srcEnd
        // so only invalid case to check is:
        const srcStart = srcConfig.Start;
        const srcEnd = srcConfig.End;
        if (srcEnd >= srcCopySize || srcStart < 0) {
          throw new errors.InvalidArgumentError(`CopySrcOptions ${index} has invalid segment-to-copy [${srcStart}, ${srcEnd}] (size is ${srcCopySize})`);
        }
        srcCopySize = srcEnd - srcStart + 1;
      }

      // Only the last source may be less than `absMinPartSize`
      if (srcCopySize < PART_CONSTRAINTS.ABS_MIN_PART_SIZE && index < sourceFilesLength - 1) {
        throw new errors.InvalidArgumentError(`CopySrcOptions ${index} is too small (${srcCopySize}) and it is not the last part.`);
      }

      // Is data to copy too large?
      totalSize += srcCopySize;
      if (totalSize > PART_CONSTRAINTS.MAX_MULTIPART_PUT_OBJECT_SIZE) {
        throw new errors.InvalidArgumentError(`Cannot compose an object of size ${totalSize} (> 5TiB)`);
      }

      // record source size
      srcObjectSizes[index] = srcCopySize;

      // calculate parts needed for current source
      totalParts += partsRequired(srcCopySize);
      // Do we need more parts than we are allowed?
      if (totalParts > PART_CONSTRAINTS.MAX_PARTS_COUNT) {
        throw new errors.InvalidArgumentError(`Your proposed compose object requires more than ${PART_CONSTRAINTS.MAX_PARTS_COUNT} parts`);
      }
      return resItemStat;
    });
    if (totalParts === 1 && totalSize <= PART_CONSTRAINTS.MAX_PART_SIZE || totalSize === 0) {
      return await this.copyObject(sourceObjList[0], destObjConfig); // use copyObjectV2
    }

    // preserve etag to avoid modification of object while copying.
    for (let i = 0; i < sourceFilesLength; i++) {
      ;
      sourceObjList[i].MatchETag = validatedStats[i].etag;
    }
    const splitPartSizeList = validatedStats.map((resItemStat, idx) => {
      return calculateEvenSplits(srcObjectSizes[idx], sourceObjList[idx]);
    });
    const getUploadPartConfigList = uploadId => {
      const uploadPartConfigList = [];
      splitPartSizeList.forEach((splitSize, splitIndex) => {
        if (splitSize) {
          const {
            startIndex: startIdx,
            endIndex: endIdx,
            objInfo: objConfig
          } = splitSize;
          const partIndex = splitIndex + 1; // part index starts from 1.
          const totalUploads = Array.from(startIdx);
          const headers = sourceObjList[splitIndex].getHeaders();
          totalUploads.forEach((splitStart, upldCtrIdx) => {
            const splitEnd = endIdx[upldCtrIdx];
            const sourceObj = `${objConfig.Bucket}/${objConfig.Object}`;
            headers['x-amz-copy-source'] = `${sourceObj}`;
            headers['x-amz-copy-source-range'] = `bytes=${splitStart}-${splitEnd}`;
            const uploadPartConfig = {
              bucketName: destObjConfig.Bucket,
              objectName: destObjConfig.Object,
              uploadID: uploadId,
              partNumber: partIndex,
              headers: headers,
              sourceObj: sourceObj
            };
            uploadPartConfigList.push(uploadPartConfig);
          });
        }
      });
      return uploadPartConfigList;
    };
    const uploadAllParts = async uploadList => {
      const partUploads = uploadList.map(async item => {
        return this.uploadPart(item);
      });
      // Process results here if needed
      return await Promise.all(partUploads);
    };
    const performUploadParts = async uploadId => {
      const uploadList = getUploadPartConfigList(uploadId);
      const partsRes = await uploadAllParts(uploadList);
      return partsRes.map(partCopy => ({
        etag: partCopy.etag,
        part: partCopy.part
      }));
    };
    const newUploadHeaders = destObjConfig.getHeaders();
    const uploadId = await this.initiateNewMultipartUpload(destObjConfig.Bucket, destObjConfig.Object, newUploadHeaders);
    try {
      const partsDone = await performUploadParts(uploadId);
      return await this.completeMultipartUpload(destObjConfig.Bucket, destObjConfig.Object, uploadId, partsDone);
    } catch (err) {
      return await this.abortMultipartUpload(destObjConfig.Bucket, destObjConfig.Object, uploadId);
    }
  }
  async presignedUrl(method, bucketName, objectName, expires, reqParams, requestDate) {
    var _requestDate;
    if (this.anonymous) {
      throw new errors.AnonymousRequestError(`Presigned ${method} url cannot be generated for anonymous requests`);
    }
    if (!expires) {
      expires = PRESIGN_EXPIRY_DAYS_MAX;
    }
    if (!reqParams) {
      reqParams = {};
    }
    if (!requestDate) {
      requestDate = new Date();
    }

    // Type assertions
    if (expires && typeof expires !== 'number') {
      throw new TypeError('expires should be of type "number"');
    }
    if (reqParams && typeof reqParams !== 'object') {
      throw new TypeError('reqParams should be of type "object"');
    }
    if (requestDate && !(requestDate instanceof Date) || requestDate && isNaN((_requestDate = requestDate) === null || _requestDate === void 0 ? void 0 : _requestDate.getTime())) {
      throw new TypeError('requestDate should be of type "Date" and valid');
    }
    const query = reqParams ? qs.stringify(reqParams) : undefined;
    try {
      const region = await this.getBucketRegionAsync(bucketName);
      await this.checkAndRefreshCreds();
      const reqOptions = this.getRequestOptions({
        method,
        region,
        bucketName,
        objectName,
        query
      });
      return presignSignatureV4(reqOptions, this.accessKey, this.secretKey, this.sessionToken, region, requestDate, expires);
    } catch (err) {
      if (err instanceof errors.InvalidBucketNameError) {
        throw new errors.InvalidArgumentError(`Unable to get bucket region for ${bucketName}.`);
      }
      throw err;
    }
  }
  async presignedGetObject(bucketName, objectName, expires, respHeaders, requestDate) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    const validRespHeaders = ['response-content-type', 'response-content-language', 'response-expires', 'response-cache-control', 'response-content-disposition', 'response-content-encoding'];
    validRespHeaders.forEach(header => {
      // @ts-ignore
      if (respHeaders !== undefined && respHeaders[header] !== undefined && !isString(respHeaders[header])) {
        throw new TypeError(`response header ${header} should be of type "string"`);
      }
    });
    return this.presignedUrl('GET', bucketName, objectName, expires, respHeaders, requestDate);
  }
  async presignedPutObject(bucketName, objectName, expires) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    return this.presignedUrl('PUT', bucketName, objectName, expires);
  }
  newPostPolicy() {
    return new PostPolicy();
  }
  async presignedPostPolicy(postPolicy) {
    if (this.anonymous) {
      throw new errors.AnonymousRequestError('Presigned POST policy cannot be generated for anonymous requests');
    }
    if (!isObject(postPolicy)) {
      throw new TypeError('postPolicy should be of type "object"');
    }
    const bucketName = postPolicy.formData.bucket;
    try {
      const region = await this.getBucketRegionAsync(bucketName);
      const date = new Date();
      const dateStr = makeDateLong(date);
      await this.checkAndRefreshCreds();
      if (!postPolicy.policy.expiration) {
        // 'expiration' is mandatory field for S3.
        // Set default expiration date of 7 days.
        const expires = new Date();
        expires.setSeconds(PRESIGN_EXPIRY_DAYS_MAX);
        postPolicy.setExpires(expires);
      }
      postPolicy.policy.conditions.push(['eq', '$x-amz-date', dateStr]);
      postPolicy.formData['x-amz-date'] = dateStr;
      postPolicy.policy.conditions.push(['eq', '$x-amz-algorithm', 'AWS4-HMAC-SHA256']);
      postPolicy.formData['x-amz-algorithm'] = 'AWS4-HMAC-SHA256';
      postPolicy.policy.conditions.push(['eq', '$x-amz-credential', this.accessKey + '/' + getScope(region, date)]);
      postPolicy.formData['x-amz-credential'] = this.accessKey + '/' + getScope(region, date);
      if (this.sessionToken) {
        postPolicy.policy.conditions.push(['eq', '$x-amz-security-token', this.sessionToken]);
        postPolicy.formData['x-amz-security-token'] = this.sessionToken;
      }
      const policyBase64 = Buffer.from(JSON.stringify(postPolicy.policy)).toString('base64');
      postPolicy.formData.policy = policyBase64;
      postPolicy.formData['x-amz-signature'] = postPresignSignatureV4(region, date, this.secretKey, policyBase64);
      const opts = {
        region: region,
        bucketName: bucketName,
        method: 'POST'
      };
      const reqOptions = this.getRequestOptions(opts);
      const portStr = this.port == 80 || this.port === 443 ? '' : `:${this.port.toString()}`;
      const urlStr = `${reqOptions.protocol}//${reqOptions.host}${portStr}${reqOptions.path}`;
      return {
        postURL: urlStr,
        formData: postPolicy.formData
      };
    } catch (err) {
      if (err instanceof errors.InvalidBucketNameError) {
        throw new errors.InvalidArgumentError(`Unable to get bucket region for ${bucketName}.`);
      }
      throw err;
    }
  }
  // list a batch of objects
  async listObjectsQuery(bucketName, prefix, marker, listQueryOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isString(marker)) {
      throw new TypeError('marker should be of type "string"');
    }
    if (listQueryOpts && !isObject(listQueryOpts)) {
      throw new TypeError('listQueryOpts should be of type "object"');
    }
    let {
      Delimiter,
      MaxKeys,
      IncludeVersion
    } = listQueryOpts;
    if (!isString(Delimiter)) {
      throw new TypeError('Delimiter should be of type "string"');
    }
    if (!isNumber(MaxKeys)) {
      throw new TypeError('MaxKeys should be of type "number"');
    }
    const queries = [];
    // escape every value in query string, except maxKeys
    queries.push(`prefix=${uriEscape(prefix)}`);
    queries.push(`delimiter=${uriEscape(Delimiter)}`);
    queries.push(`encoding-type=url`);
    if (IncludeVersion) {
      queries.push(`versions`);
    }
    if (marker) {
      marker = uriEscape(marker);
      if (IncludeVersion) {
        queries.push(`key-marker=${marker}`);
      } else {
        queries.push(`marker=${marker}`);
      }
    }

    // no need to escape maxKeys
    if (MaxKeys) {
      if (MaxKeys >= 1000) {
        MaxKeys = 1000;
      }
      queries.push(`max-keys=${MaxKeys}`);
    }
    queries.sort();
    let query = '';
    if (queries.length > 0) {
      query = `${queries.join('&')}`;
    }
    const method = 'GET';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await readAsString(res);
    const listQryList = parseListObjects(body);
    return listQryList;
  }
  listObjects(bucketName, prefix, recursive, listOpts) {
    if (prefix === undefined) {
      prefix = '';
    }
    if (recursive === undefined) {
      recursive = false;
    }
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidPrefix(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isBoolean(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    if (listOpts && !isObject(listOpts)) {
      throw new TypeError('listOpts should be of type "object"');
    }
    let marker = '';
    const listQueryOpts = {
      Delimiter: recursive ? '' : '/',
      // if recursive is false set delimiter to '/'
      MaxKeys: 1000,
      IncludeVersion: listOpts === null || listOpts === void 0 ? void 0 : listOpts.IncludeVersion
    };
    let objects = [];
    let ended = false;
    const readStream = new stream.Readable({
      objectMode: true
    });
    readStream._read = async () => {
      // push one object per _read()
      if (objects.length) {
        readStream.push(objects.shift());
        return;
      }
      if (ended) {
        return readStream.push(null);
      }
      try {
        const result = await this.listObjectsQuery(bucketName, prefix, marker, listQueryOpts);
        if (result.isTruncated) {
          marker = result.nextMarker || result.versionIdMarker;
        } else {
          ended = true;
        }
        if (result.objects) {
          objects = result.objects;
        }
        // @ts-ignore
        readStream._read();
      } catch (err) {
        readStream.emit('error', err);
      }
    };
    return readStream;
  }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcnlwdG8iLCJmcyIsImh0dHAiLCJodHRwcyIsInBhdGgiLCJzdHJlYW0iLCJhc3luYyIsIkJsb2NrU3RyZWFtMiIsImlzQnJvd3NlciIsIl8iLCJxcyIsInhtbDJqcyIsIkNyZWRlbnRpYWxQcm92aWRlciIsImVycm9ycyIsIkNvcHlEZXN0aW5hdGlvbk9wdGlvbnMiLCJDb3B5U291cmNlT3B0aW9ucyIsIkRFRkFVTFRfUkVHSU9OIiwiTEVHQUxfSE9MRF9TVEFUVVMiLCJQUkVTSUdOX0VYUElSWV9EQVlTX01BWCIsIlJFVEVOVElPTl9NT0RFUyIsIlJFVEVOVElPTl9WQUxJRElUWV9VTklUUyIsInBvc3RQcmVzaWduU2lnbmF0dXJlVjQiLCJwcmVzaWduU2lnbmF0dXJlVjQiLCJzaWduVjQiLCJmc3AiLCJzdHJlYW1Qcm9taXNlIiwiQ29weUNvbmRpdGlvbnMiLCJFeHRlbnNpb25zIiwiY2FsY3VsYXRlRXZlblNwbGl0cyIsImV4dHJhY3RNZXRhZGF0YSIsImdldENvbnRlbnRMZW5ndGgiLCJnZXRTY29wZSIsImdldFNvdXJjZVZlcnNpb25JZCIsImdldFZlcnNpb25JZCIsImhhc2hCaW5hcnkiLCJpbnNlcnRDb250ZW50VHlwZSIsImlzQW1hem9uRW5kcG9pbnQiLCJpc0Jvb2xlYW4iLCJpc0RlZmluZWQiLCJpc0VtcHR5IiwiaXNOdW1iZXIiLCJpc09iamVjdCIsImlzUmVhZGFibGVTdHJlYW0iLCJpc1N0cmluZyIsImlzVmFsaWRCdWNrZXROYW1lIiwiaXNWYWxpZEVuZHBvaW50IiwiaXNWYWxpZE9iamVjdE5hbWUiLCJpc1ZhbGlkUG9ydCIsImlzVmFsaWRQcmVmaXgiLCJpc1ZpcnR1YWxIb3N0U3R5bGUiLCJtYWtlRGF0ZUxvbmciLCJQQVJUX0NPTlNUUkFJTlRTIiwicGFydHNSZXF1aXJlZCIsInByZXBlbmRYQU1aTWV0YSIsInJlYWRhYmxlU3RyZWFtIiwic2FuaXRpemVFVGFnIiwidG9NZDUiLCJ0b1NoYTI1NiIsInVyaUVzY2FwZSIsInVyaVJlc291cmNlRXNjYXBlIiwiam9pbkhvc3RQb3J0IiwiUG9zdFBvbGljeSIsInJlcXVlc3RXaXRoUmV0cnkiLCJkcmFpblJlc3BvbnNlIiwicmVhZEFzQnVmZmVyIiwicmVhZEFzU3RyaW5nIiwiZ2V0UzNFbmRwb2ludCIsInBhcnNlQ29tcGxldGVNdWx0aXBhcnQiLCJwYXJzZUluaXRpYXRlTXVsdGlwYXJ0IiwicGFyc2VMaXN0T2JqZWN0cyIsInBhcnNlT2JqZWN0TGVnYWxIb2xkQ29uZmlnIiwicGFyc2VTZWxlY3RPYmplY3RDb250ZW50UmVzcG9uc2UiLCJ1cGxvYWRQYXJ0UGFyc2VyIiwieG1sUGFyc2VycyIsInhtbCIsIkJ1aWxkZXIiLCJyZW5kZXJPcHRzIiwicHJldHR5IiwiaGVhZGxlc3MiLCJQYWNrYWdlIiwidmVyc2lvbiIsInJlcXVlc3RPcHRpb25Qcm9wZXJ0aWVzIiwiVHlwZWRDbGllbnQiLCJwYXJ0U2l6ZSIsIm1heGltdW1QYXJ0U2l6ZSIsIm1heE9iamVjdFNpemUiLCJjb25zdHJ1Y3RvciIsInBhcmFtcyIsInNlY3VyZSIsInVuZGVmaW5lZCIsIkVycm9yIiwidXNlU1NMIiwicG9ydCIsImVuZFBvaW50IiwiSW52YWxpZEVuZHBvaW50RXJyb3IiLCJJbnZhbGlkQXJndW1lbnRFcnJvciIsInJlZ2lvbiIsImhvc3QiLCJ0b0xvd2VyQ2FzZSIsInByb3RvY29sIiwidHJhbnNwb3J0IiwidHJhbnNwb3J0QWdlbnQiLCJnbG9iYWxBZ2VudCIsImxpYnJhcnlDb21tZW50cyIsInByb2Nlc3MiLCJwbGF0Zm9ybSIsImFyY2giLCJsaWJyYXJ5QWdlbnQiLCJ1c2VyQWdlbnQiLCJwYXRoU3R5bGUiLCJhY2Nlc3NLZXkiLCJzZWNyZXRLZXkiLCJzZXNzaW9uVG9rZW4iLCJhbm9ueW1vdXMiLCJjcmVkZW50aWFsc1Byb3ZpZGVyIiwicmVnaW9uTWFwIiwib3ZlclJpZGVQYXJ0U2l6ZSIsImVuYWJsZVNIQTI1NiIsInMzQWNjZWxlcmF0ZUVuZHBvaW50IiwicmVxT3B0aW9ucyIsImNsaWVudEV4dGVuc2lvbnMiLCJleHRlbnNpb25zIiwic2V0UzNUcmFuc2ZlckFjY2VsZXJhdGUiLCJzZXRSZXF1ZXN0T3B0aW9ucyIsIm9wdGlvbnMiLCJUeXBlRXJyb3IiLCJwaWNrIiwiZ2V0QWNjZWxlcmF0ZUVuZFBvaW50SWZTZXQiLCJidWNrZXROYW1lIiwib2JqZWN0TmFtZSIsImluY2x1ZGVzIiwic2V0QXBwSW5mbyIsImFwcE5hbWUiLCJhcHBWZXJzaW9uIiwidHJpbSIsImdldFJlcXVlc3RPcHRpb25zIiwib3B0cyIsIm1ldGhvZCIsImhlYWRlcnMiLCJxdWVyeSIsImFnZW50IiwidmlydHVhbEhvc3RTdHlsZSIsImFjY2VsZXJhdGVFbmRQb2ludCIsImsiLCJ2IiwiT2JqZWN0IiwiZW50cmllcyIsImFzc2lnbiIsIm1hcFZhbHVlcyIsInBpY2tCeSIsInRvU3RyaW5nIiwic2V0Q3JlZGVudGlhbHNQcm92aWRlciIsImNoZWNrQW5kUmVmcmVzaENyZWRzIiwiY3JlZGVudGlhbHNDb25mIiwiZ2V0Q3JlZGVudGlhbHMiLCJnZXRBY2Nlc3NLZXkiLCJnZXRTZWNyZXRLZXkiLCJnZXRTZXNzaW9uVG9rZW4iLCJlIiwiY2F1c2UiLCJsb2dIVFRQIiwicmVzcG9uc2UiLCJlcnIiLCJsb2dTdHJlYW0iLCJsb2dIZWFkZXJzIiwiZm9yRWFjaCIsInJlZGFjdG9yIiwiUmVnRXhwIiwicmVwbGFjZSIsIndyaXRlIiwic3RhdHVzQ29kZSIsImVyckpTT04iLCJKU09OIiwic3RyaW5naWZ5IiwidHJhY2VPbiIsInN0ZG91dCIsInRyYWNlT2ZmIiwibWFrZVJlcXVlc3RBc3luYyIsInBheWxvYWQiLCJleHBlY3RlZENvZGVzIiwibGVuZ3RoIiwic2hhMjU2c3VtIiwibWFrZVJlcXVlc3RTdHJlYW1Bc3luYyIsIm1ha2VSZXF1ZXN0QXN5bmNPbWl0Iiwic3RhdHVzQ29kZXMiLCJyZXMiLCJib2R5IiwiQnVmZmVyIiwiaXNCdWZmZXIiLCJnZXRCdWNrZXRSZWdpb25Bc3luYyIsImRhdGUiLCJEYXRlIiwiYXV0aG9yaXphdGlvbiIsInBhcnNlUmVzcG9uc2VFcnJvciIsIkludmFsaWRCdWNrZXROYW1lRXJyb3IiLCJjYWNoZWQiLCJleHRyYWN0UmVnaW9uQXN5bmMiLCJwYXJzZUJ1Y2tldFJlZ2lvbiIsIlMzRXJyb3IiLCJlcnJDb2RlIiwiY29kZSIsImVyclJlZ2lvbiIsIm5hbWUiLCJSZWdpb24iLCJtYWtlUmVxdWVzdCIsInJldHVyblJlc3BvbnNlIiwiY2IiLCJwcm9tIiwidGhlbiIsInJlc3VsdCIsIm1ha2VSZXF1ZXN0U3RyZWFtIiwiZXhlY3V0b3IiLCJnZXRCdWNrZXRSZWdpb24iLCJtYWtlQnVja2V0IiwibWFrZU9wdHMiLCJidWlsZE9iamVjdCIsIkNyZWF0ZUJ1Y2tldENvbmZpZ3VyYXRpb24iLCIkIiwieG1sbnMiLCJMb2NhdGlvbkNvbnN0cmFpbnQiLCJPYmplY3RMb2NraW5nIiwiZmluYWxSZWdpb24iLCJyZXF1ZXN0T3B0IiwiYnVja2V0RXhpc3RzIiwicmVtb3ZlQnVja2V0IiwiZ2V0T2JqZWN0IiwiZ2V0T3B0cyIsIkludmFsaWRPYmplY3ROYW1lRXJyb3IiLCJnZXRQYXJ0aWFsT2JqZWN0Iiwib2Zmc2V0IiwicmFuZ2UiLCJzc2VIZWFkZXJzIiwiU1NFQ3VzdG9tZXJBbGdvcml0aG0iLCJTU0VDdXN0b21lcktleSIsIlNTRUN1c3RvbWVyS2V5TUQ1IiwiZXhwZWN0ZWRTdGF0dXNDb2RlcyIsInB1c2giLCJmR2V0T2JqZWN0IiwiZmlsZVBhdGgiLCJkb3dubG9hZFRvVG1wRmlsZSIsInBhcnRGaWxlU3RyZWFtIiwib2JqU3RhdCIsInN0YXRPYmplY3QiLCJlbmNvZGVkRXRhZyIsImZyb20iLCJldGFnIiwicGFydEZpbGUiLCJta2RpciIsImRpcm5hbWUiLCJyZWN1cnNpdmUiLCJzdGF0cyIsInN0YXQiLCJzaXplIiwiY3JlYXRlV3JpdGVTdHJlYW0iLCJmbGFncyIsImRvd25sb2FkU3RyZWFtIiwicGlwZWxpbmUiLCJyZW5hbWUiLCJzdGF0T3B0cyIsInN0YXRPcHREZWYiLCJwYXJzZUludCIsIm1ldGFEYXRhIiwibGFzdE1vZGlmaWVkIiwidmVyc2lvbklkIiwicmVtb3ZlT2JqZWN0IiwicmVtb3ZlT3B0cyIsImdvdmVybmFuY2VCeXBhc3MiLCJmb3JjZURlbGV0ZSIsInF1ZXJ5UGFyYW1zIiwibGlzdEluY29tcGxldGVVcGxvYWRzIiwiYnVja2V0IiwicHJlZml4IiwiSW52YWxpZFByZWZpeEVycm9yIiwiZGVsaW1pdGVyIiwia2V5TWFya2VyIiwidXBsb2FkSWRNYXJrZXIiLCJ1cGxvYWRzIiwiZW5kZWQiLCJyZWFkU3RyZWFtIiwiUmVhZGFibGUiLCJvYmplY3RNb2RlIiwiX3JlYWQiLCJzaGlmdCIsImxpc3RJbmNvbXBsZXRlVXBsb2Fkc1F1ZXJ5IiwicHJlZml4ZXMiLCJlYWNoU2VyaWVzIiwidXBsb2FkIiwibGlzdFBhcnRzIiwia2V5IiwidXBsb2FkSWQiLCJwYXJ0cyIsInJlZHVjZSIsImFjYyIsIml0ZW0iLCJlbWl0IiwiaXNUcnVuY2F0ZWQiLCJuZXh0S2V5TWFya2VyIiwibmV4dFVwbG9hZElkTWFya2VyIiwicXVlcmllcyIsIm1heFVwbG9hZHMiLCJzb3J0IiwidW5zaGlmdCIsImpvaW4iLCJwYXJzZUxpc3RNdWx0aXBhcnQiLCJpbml0aWF0ZU5ld011bHRpcGFydFVwbG9hZCIsImFib3J0TXVsdGlwYXJ0VXBsb2FkIiwicmVxdWVzdE9wdGlvbnMiLCJmaW5kVXBsb2FkSWQiLCJfbGF0ZXN0VXBsb2FkIiwibGF0ZXN0VXBsb2FkIiwiaW5pdGlhdGVkIiwiZ2V0VGltZSIsImNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkIiwiZXRhZ3MiLCJidWlsZGVyIiwiQ29tcGxldGVNdWx0aXBhcnRVcGxvYWQiLCJQYXJ0IiwibWFwIiwiUGFydE51bWJlciIsInBhcnQiLCJFVGFnIiwiZXJyTWVzc2FnZSIsIm1hcmtlciIsImxpc3RQYXJ0c1F1ZXJ5IiwicGFyc2VMaXN0UGFydHMiLCJsaXN0QnVja2V0cyIsInJlZ2lvbkNvbmYiLCJodHRwUmVzIiwieG1sUmVzdWx0IiwicGFyc2VMaXN0QnVja2V0IiwiY2FsY3VsYXRlUGFydFNpemUiLCJmUHV0T2JqZWN0IiwibHN0YXQiLCJwdXRPYmplY3QiLCJjcmVhdGVSZWFkU3RyZWFtIiwic3RhdFNpemUiLCJyZWFkYWJsZUxlbmd0aCIsImJ1ZiIsInVwbG9hZEJ1ZmZlciIsInVwbG9hZFN0cmVhbSIsIm1kNXN1bSIsIm9sZFBhcnRzIiwiZVRhZ3MiLCJwcmV2aW91c1VwbG9hZElkIiwib2xkVGFncyIsImNodW5raWVyIiwiemVyb1BhZGRpbmciLCJvIiwiUHJvbWlzZSIsImFsbCIsInJlc29sdmUiLCJyZWplY3QiLCJwaXBlIiwib24iLCJwYXJ0TnVtYmVyIiwiY2h1bmsiLCJtZDUiLCJjcmVhdGVIYXNoIiwidXBkYXRlIiwiZGlnZXN0Iiwib2xkUGFydCIsInJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uIiwic2V0QnVja2V0UmVwbGljYXRpb24iLCJyZXBsaWNhdGlvbkNvbmZpZyIsInJvbGUiLCJydWxlcyIsInJlcGxpY2F0aW9uUGFyYW1zQ29uZmlnIiwiUmVwbGljYXRpb25Db25maWd1cmF0aW9uIiwiUm9sZSIsIlJ1bGUiLCJnZXRCdWNrZXRSZXBsaWNhdGlvbiIsInBhcnNlUmVwbGljYXRpb25Db25maWciLCJnZXRPYmplY3RMZWdhbEhvbGQiLCJrZXlzIiwic3RyUmVzIiwic2V0T2JqZWN0TGVnYWxIb2xkIiwic2V0T3B0cyIsInN0YXR1cyIsIkVOQUJMRUQiLCJESVNBQkxFRCIsImNvbmZpZyIsIlN0YXR1cyIsInJvb3ROYW1lIiwiZ2V0QnVja2V0VGFnZ2luZyIsInBhcnNlVGFnZ2luZyIsImdldE9iamVjdFRhZ2dpbmciLCJzZXRCdWNrZXRQb2xpY3kiLCJwb2xpY3kiLCJJbnZhbGlkQnVja2V0UG9saWN5RXJyb3IiLCJnZXRCdWNrZXRQb2xpY3kiLCJwdXRPYmplY3RSZXRlbnRpb24iLCJyZXRlbnRpb25PcHRzIiwibW9kZSIsIkNPTVBMSUFOQ0UiLCJHT1ZFUk5BTkNFIiwicmV0YWluVW50aWxEYXRlIiwiTW9kZSIsIlJldGFpblVudGlsRGF0ZSIsImdldE9iamVjdExvY2tDb25maWciLCJwYXJzZU9iamVjdExvY2tDb25maWciLCJzZXRPYmplY3RMb2NrQ29uZmlnIiwibG9ja0NvbmZpZ09wdHMiLCJyZXRlbnRpb25Nb2RlcyIsInZhbGlkVW5pdHMiLCJEQVlTIiwiWUVBUlMiLCJ1bml0IiwidmFsaWRpdHkiLCJPYmplY3RMb2NrRW5hYmxlZCIsImNvbmZpZ0tleXMiLCJpc0FsbEtleXNTZXQiLCJldmVyeSIsImxjayIsIkRlZmF1bHRSZXRlbnRpb24iLCJEYXlzIiwiWWVhcnMiLCJnZXRCdWNrZXRWZXJzaW9uaW5nIiwicGFyc2VCdWNrZXRWZXJzaW9uaW5nQ29uZmlnIiwic2V0QnVja2V0VmVyc2lvbmluZyIsInZlcnNpb25Db25maWciLCJzZXRUYWdnaW5nIiwidGFnZ2luZ1BhcmFtcyIsInRhZ3MiLCJwdXRPcHRzIiwidGFnc0xpc3QiLCJ2YWx1ZSIsIktleSIsIlZhbHVlIiwidGFnZ2luZ0NvbmZpZyIsIlRhZ2dpbmciLCJUYWdTZXQiLCJUYWciLCJwYXlsb2FkQnVmIiwicmVtb3ZlVGFnZ2luZyIsInNldEJ1Y2tldFRhZ2dpbmciLCJyZW1vdmVCdWNrZXRUYWdnaW5nIiwic2V0T2JqZWN0VGFnZ2luZyIsInJlbW92ZU9iamVjdFRhZ2dpbmciLCJzZWxlY3RPYmplY3RDb250ZW50Iiwic2VsZWN0T3B0cyIsImV4cHJlc3Npb24iLCJpbnB1dFNlcmlhbGl6YXRpb24iLCJvdXRwdXRTZXJpYWxpemF0aW9uIiwiRXhwcmVzc2lvbiIsIkV4cHJlc3Npb25UeXBlIiwiZXhwcmVzc2lvblR5cGUiLCJJbnB1dFNlcmlhbGl6YXRpb24iLCJPdXRwdXRTZXJpYWxpemF0aW9uIiwicmVxdWVzdFByb2dyZXNzIiwiUmVxdWVzdFByb2dyZXNzIiwic2NhblJhbmdlIiwiU2NhblJhbmdlIiwiYXBwbHlCdWNrZXRMaWZlY3ljbGUiLCJwb2xpY3lDb25maWciLCJyZW1vdmVCdWNrZXRMaWZlY3ljbGUiLCJzZXRCdWNrZXRMaWZlY3ljbGUiLCJsaWZlQ3ljbGVDb25maWciLCJnZXRCdWNrZXRMaWZlY3ljbGUiLCJwYXJzZUxpZmVjeWNsZUNvbmZpZyIsInNldEJ1Y2tldEVuY3J5cHRpb24iLCJlbmNyeXB0aW9uQ29uZmlnIiwiZW5jcnlwdGlvbk9iaiIsIkFwcGx5U2VydmVyU2lkZUVuY3J5cHRpb25CeURlZmF1bHQiLCJTU0VBbGdvcml0aG0iLCJnZXRCdWNrZXRFbmNyeXB0aW9uIiwicGFyc2VCdWNrZXRFbmNyeXB0aW9uQ29uZmlnIiwicmVtb3ZlQnVja2V0RW5jcnlwdGlvbiIsImdldE9iamVjdFJldGVudGlvbiIsInBhcnNlT2JqZWN0UmV0ZW50aW9uQ29uZmlnIiwicmVtb3ZlT2JqZWN0cyIsIm9iamVjdHNMaXN0IiwiQXJyYXkiLCJpc0FycmF5IiwicnVuRGVsZXRlT2JqZWN0cyIsImJhdGNoIiwiZGVsT2JqZWN0cyIsIlZlcnNpb25JZCIsInJlbU9iamVjdHMiLCJEZWxldGUiLCJRdWlldCIsInJlbW92ZU9iamVjdHNQYXJzZXIiLCJtYXhFbnRyaWVzIiwiYmF0Y2hlcyIsImkiLCJzbGljZSIsImJhdGNoUmVzdWx0cyIsImZsYXQiLCJyZW1vdmVJbmNvbXBsZXRlVXBsb2FkIiwiSXNWYWxpZEJ1Y2tldE5hbWVFcnJvciIsInJlbW92ZVVwbG9hZElkIiwiY29weU9iamVjdFYxIiwidGFyZ2V0QnVja2V0TmFtZSIsInRhcmdldE9iamVjdE5hbWUiLCJzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSIsImNvbmRpdGlvbnMiLCJtb2RpZmllZCIsInVubW9kaWZpZWQiLCJtYXRjaEVUYWciLCJtYXRjaEVUYWdFeGNlcHQiLCJwYXJzZUNvcHlPYmplY3QiLCJjb3B5T2JqZWN0VjIiLCJzb3VyY2VDb25maWciLCJkZXN0Q29uZmlnIiwidmFsaWRhdGUiLCJnZXRIZWFkZXJzIiwiQnVja2V0IiwiY29weVJlcyIsInJlc0hlYWRlcnMiLCJzaXplSGVhZGVyVmFsdWUiLCJMYXN0TW9kaWZpZWQiLCJNZXRhRGF0YSIsIlNvdXJjZVZlcnNpb25JZCIsIkV0YWciLCJTaXplIiwiY29weU9iamVjdCIsImFsbEFyZ3MiLCJzb3VyY2UiLCJkZXN0IiwidXBsb2FkUGFydCIsInBhcnRDb25maWciLCJ1cGxvYWRJRCIsInBhcnRSZXMiLCJjb21wb3NlT2JqZWN0IiwiZGVzdE9iakNvbmZpZyIsInNvdXJjZU9iakxpc3QiLCJzb3VyY2VGaWxlc0xlbmd0aCIsIk1BWF9QQVJUU19DT1VOVCIsInNPYmoiLCJnZXRTdGF0T3B0aW9ucyIsInNyY0NvbmZpZyIsIlZlcnNpb25JRCIsInNyY09iamVjdFNpemVzIiwidG90YWxTaXplIiwidG90YWxQYXJ0cyIsInNvdXJjZU9ialN0YXRzIiwic3JjSXRlbSIsInNyY09iamVjdEluZm9zIiwidmFsaWRhdGVkU3RhdHMiLCJyZXNJdGVtU3RhdCIsImluZGV4Iiwic3JjQ29weVNpemUiLCJNYXRjaFJhbmdlIiwic3JjU3RhcnQiLCJTdGFydCIsInNyY0VuZCIsIkVuZCIsIkFCU19NSU5fUEFSVF9TSVpFIiwiTUFYX01VTFRJUEFSVF9QVVRfT0JKRUNUX1NJWkUiLCJNQVhfUEFSVF9TSVpFIiwiTWF0Y2hFVGFnIiwic3BsaXRQYXJ0U2l6ZUxpc3QiLCJpZHgiLCJnZXRVcGxvYWRQYXJ0Q29uZmlnTGlzdCIsInVwbG9hZFBhcnRDb25maWdMaXN0Iiwic3BsaXRTaXplIiwic3BsaXRJbmRleCIsInN0YXJ0SW5kZXgiLCJzdGFydElkeCIsImVuZEluZGV4IiwiZW5kSWR4Iiwib2JqSW5mbyIsIm9iakNvbmZpZyIsInBhcnRJbmRleCIsInRvdGFsVXBsb2FkcyIsInNwbGl0U3RhcnQiLCJ1cGxkQ3RySWR4Iiwic3BsaXRFbmQiLCJzb3VyY2VPYmoiLCJ1cGxvYWRQYXJ0Q29uZmlnIiwidXBsb2FkQWxsUGFydHMiLCJ1cGxvYWRMaXN0IiwicGFydFVwbG9hZHMiLCJwZXJmb3JtVXBsb2FkUGFydHMiLCJwYXJ0c1JlcyIsInBhcnRDb3B5IiwibmV3VXBsb2FkSGVhZGVycyIsInBhcnRzRG9uZSIsInByZXNpZ25lZFVybCIsImV4cGlyZXMiLCJyZXFQYXJhbXMiLCJyZXF1ZXN0RGF0ZSIsIl9yZXF1ZXN0RGF0ZSIsIkFub255bW91c1JlcXVlc3RFcnJvciIsImlzTmFOIiwicHJlc2lnbmVkR2V0T2JqZWN0IiwicmVzcEhlYWRlcnMiLCJ2YWxpZFJlc3BIZWFkZXJzIiwiaGVhZGVyIiwicHJlc2lnbmVkUHV0T2JqZWN0IiwibmV3UG9zdFBvbGljeSIsInByZXNpZ25lZFBvc3RQb2xpY3kiLCJwb3N0UG9saWN5IiwiZm9ybURhdGEiLCJkYXRlU3RyIiwiZXhwaXJhdGlvbiIsInNldFNlY29uZHMiLCJzZXRFeHBpcmVzIiwicG9saWN5QmFzZTY0IiwicG9ydFN0ciIsInVybFN0ciIsInBvc3RVUkwiLCJsaXN0T2JqZWN0c1F1ZXJ5IiwibGlzdFF1ZXJ5T3B0cyIsIkRlbGltaXRlciIsIk1heEtleXMiLCJJbmNsdWRlVmVyc2lvbiIsImxpc3RRcnlMaXN0IiwibGlzdE9iamVjdHMiLCJsaXN0T3B0cyIsIm9iamVjdHMiLCJuZXh0TWFya2VyIiwidmVyc2lvbklkTWFya2VyIl0sInNvdXJjZXMiOlsiY2xpZW50LnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNyeXB0byBmcm9tICdub2RlOmNyeXB0bydcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnXG5pbXBvcnQgdHlwZSB7IEluY29taW5nSHR0cEhlYWRlcnMgfSBmcm9tICdub2RlOmh0dHAnXG5pbXBvcnQgKiBhcyBodHRwIGZyb20gJ25vZGU6aHR0cCdcbmltcG9ydCAqIGFzIGh0dHBzIGZyb20gJ25vZGU6aHR0cHMnXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ25vZGU6cGF0aCdcbmltcG9ydCAqIGFzIHN0cmVhbSBmcm9tICdub2RlOnN0cmVhbSdcblxuaW1wb3J0ICogYXMgYXN5bmMgZnJvbSAnYXN5bmMnXG5pbXBvcnQgQmxvY2tTdHJlYW0yIGZyb20gJ2Jsb2NrLXN0cmVhbTInXG5pbXBvcnQgeyBpc0Jyb3dzZXIgfSBmcm9tICdicm93c2VyLW9yLW5vZGUnXG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnXG5pbXBvcnQgKiBhcyBxcyBmcm9tICdxdWVyeS1zdHJpbmcnXG5pbXBvcnQgeG1sMmpzIGZyb20gJ3htbDJqcydcblxuaW1wb3J0IHsgQ3JlZGVudGlhbFByb3ZpZGVyIH0gZnJvbSAnLi4vQ3JlZGVudGlhbFByb3ZpZGVyLnRzJ1xuaW1wb3J0ICogYXMgZXJyb3JzIGZyb20gJy4uL2Vycm9ycy50cydcbmltcG9ydCB0eXBlIHsgU2VsZWN0UmVzdWx0cyB9IGZyb20gJy4uL2hlbHBlcnMudHMnXG5pbXBvcnQge1xuICBDb3B5RGVzdGluYXRpb25PcHRpb25zLFxuICBDb3B5U291cmNlT3B0aW9ucyxcbiAgREVGQVVMVF9SRUdJT04sXG4gIExFR0FMX0hPTERfU1RBVFVTLFxuICBQUkVTSUdOX0VYUElSWV9EQVlTX01BWCxcbiAgUkVURU5USU9OX01PREVTLFxuICBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMsXG59IGZyb20gJy4uL2hlbHBlcnMudHMnXG5pbXBvcnQgdHlwZSB7IFBvc3RQb2xpY3lSZXN1bHQgfSBmcm9tICcuLi9taW5pby50cydcbmltcG9ydCB7IHBvc3RQcmVzaWduU2lnbmF0dXJlVjQsIHByZXNpZ25TaWduYXR1cmVWNCwgc2lnblY0IH0gZnJvbSAnLi4vc2lnbmluZy50cydcbmltcG9ydCB7IGZzcCwgc3RyZWFtUHJvbWlzZSB9IGZyb20gJy4vYXN5bmMudHMnXG5pbXBvcnQgeyBDb3B5Q29uZGl0aW9ucyB9IGZyb20gJy4vY29weS1jb25kaXRpb25zLnRzJ1xuaW1wb3J0IHsgRXh0ZW5zaW9ucyB9IGZyb20gJy4vZXh0ZW5zaW9ucy50cydcbmltcG9ydCB7XG4gIGNhbGN1bGF0ZUV2ZW5TcGxpdHMsXG4gIGV4dHJhY3RNZXRhZGF0YSxcbiAgZ2V0Q29udGVudExlbmd0aCxcbiAgZ2V0U2NvcGUsXG4gIGdldFNvdXJjZVZlcnNpb25JZCxcbiAgZ2V0VmVyc2lvbklkLFxuICBoYXNoQmluYXJ5LFxuICBpbnNlcnRDb250ZW50VHlwZSxcbiAgaXNBbWF6b25FbmRwb2ludCxcbiAgaXNCb29sZWFuLFxuICBpc0RlZmluZWQsXG4gIGlzRW1wdHksXG4gIGlzTnVtYmVyLFxuICBpc09iamVjdCxcbiAgaXNSZWFkYWJsZVN0cmVhbSxcbiAgaXNTdHJpbmcsXG4gIGlzVmFsaWRCdWNrZXROYW1lLFxuICBpc1ZhbGlkRW5kcG9pbnQsXG4gIGlzVmFsaWRPYmplY3ROYW1lLFxuICBpc1ZhbGlkUG9ydCxcbiAgaXNWYWxpZFByZWZpeCxcbiAgaXNWaXJ0dWFsSG9zdFN0eWxlLFxuICBtYWtlRGF0ZUxvbmcsXG4gIFBBUlRfQ09OU1RSQUlOVFMsXG4gIHBhcnRzUmVxdWlyZWQsXG4gIHByZXBlbmRYQU1aTWV0YSxcbiAgcmVhZGFibGVTdHJlYW0sXG4gIHNhbml0aXplRVRhZyxcbiAgdG9NZDUsXG4gIHRvU2hhMjU2LFxuICB1cmlFc2NhcGUsXG4gIHVyaVJlc291cmNlRXNjYXBlLFxufSBmcm9tICcuL2hlbHBlci50cydcbmltcG9ydCB7IGpvaW5Ib3N0UG9ydCB9IGZyb20gJy4vam9pbi1ob3N0LXBvcnQudHMnXG5pbXBvcnQgeyBQb3N0UG9saWN5IH0gZnJvbSAnLi9wb3N0LXBvbGljeS50cydcbmltcG9ydCB7IHJlcXVlc3RXaXRoUmV0cnkgfSBmcm9tICcuL3JlcXVlc3QudHMnXG5pbXBvcnQgeyBkcmFpblJlc3BvbnNlLCByZWFkQXNCdWZmZXIsIHJlYWRBc1N0cmluZyB9IGZyb20gJy4vcmVzcG9uc2UudHMnXG5pbXBvcnQgdHlwZSB7IFJlZ2lvbiB9IGZyb20gJy4vczMtZW5kcG9pbnRzLnRzJ1xuaW1wb3J0IHsgZ2V0UzNFbmRwb2ludCB9IGZyb20gJy4vczMtZW5kcG9pbnRzLnRzJ1xuaW1wb3J0IHR5cGUge1xuICBCaW5hcnksXG4gIEJ1Y2tldEl0ZW1Gcm9tTGlzdCxcbiAgQnVja2V0SXRlbVN0YXQsXG4gIEJ1Y2tldFN0cmVhbSxcbiAgQnVja2V0VmVyc2lvbmluZ0NvbmZpZ3VyYXRpb24sXG4gIENvcHlPYmplY3RQYXJhbXMsXG4gIENvcHlPYmplY3RSZXN1bHQsXG4gIENvcHlPYmplY3RSZXN1bHRWMixcbiAgRW5jcnlwdGlvbkNvbmZpZyxcbiAgR2V0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyxcbiAgR2V0T2JqZWN0T3B0cyxcbiAgR2V0T2JqZWN0UmV0ZW50aW9uT3B0cyxcbiAgSW5jb21wbGV0ZVVwbG9hZGVkQnVja2V0SXRlbSxcbiAgSVJlcXVlc3QsXG4gIEl0ZW1CdWNrZXRNZXRhZGF0YSxcbiAgTGlmZWN5Y2xlQ29uZmlnLFxuICBMaWZlQ3ljbGVDb25maWdQYXJhbSxcbiAgTGlzdE9iamVjdFF1ZXJ5T3B0cyxcbiAgTGlzdE9iamVjdFF1ZXJ5UmVzLFxuICBPYmplY3RJbmZvLFxuICBPYmplY3RMb2NrQ29uZmlnUGFyYW0sXG4gIE9iamVjdExvY2tJbmZvLFxuICBPYmplY3RNZXRhRGF0YSxcbiAgT2JqZWN0UmV0ZW50aW9uSW5mbyxcbiAgUHJlU2lnblJlcXVlc3RQYXJhbXMsXG4gIFB1dE9iamVjdExlZ2FsSG9sZE9wdGlvbnMsXG4gIFB1dFRhZ2dpbmdQYXJhbXMsXG4gIFJlbW92ZU9iamVjdHNQYXJhbSxcbiAgUmVtb3ZlT2JqZWN0c1JlcXVlc3RFbnRyeSxcbiAgUmVtb3ZlT2JqZWN0c1Jlc3BvbnNlLFxuICBSZW1vdmVUYWdnaW5nUGFyYW1zLFxuICBSZXBsaWNhdGlvbkNvbmZpZyxcbiAgUmVwbGljYXRpb25Db25maWdPcHRzLFxuICBSZXF1ZXN0SGVhZGVycyxcbiAgUmVzcG9uc2VIZWFkZXIsXG4gIFJlc3VsdENhbGxiYWNrLFxuICBSZXRlbnRpb24sXG4gIFNlbGVjdE9wdGlvbnMsXG4gIFN0YXRPYmplY3RPcHRzLFxuICBUYWcsXG4gIFRhZ2dpbmdPcHRzLFxuICBUYWdzLFxuICBUcmFuc3BvcnQsXG4gIFVwbG9hZGVkT2JqZWN0SW5mbyxcbiAgVXBsb2FkUGFydENvbmZpZyxcbn0gZnJvbSAnLi90eXBlLnRzJ1xuaW1wb3J0IHR5cGUgeyBMaXN0TXVsdGlwYXJ0UmVzdWx0LCBVcGxvYWRlZFBhcnQgfSBmcm9tICcuL3htbC1wYXJzZXIudHMnXG5pbXBvcnQge1xuICBwYXJzZUNvbXBsZXRlTXVsdGlwYXJ0LFxuICBwYXJzZUluaXRpYXRlTXVsdGlwYXJ0LFxuICBwYXJzZUxpc3RPYmplY3RzLFxuICBwYXJzZU9iamVjdExlZ2FsSG9sZENvbmZpZyxcbiAgcGFyc2VTZWxlY3RPYmplY3RDb250ZW50UmVzcG9uc2UsXG4gIHVwbG9hZFBhcnRQYXJzZXIsXG59IGZyb20gJy4veG1sLXBhcnNlci50cydcbmltcG9ydCAqIGFzIHhtbFBhcnNlcnMgZnJvbSAnLi94bWwtcGFyc2VyLnRzJ1xuXG5jb25zdCB4bWwgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSwgaGVhZGxlc3M6IHRydWUgfSlcblxuLy8gd2lsbCBiZSByZXBsYWNlZCBieSBidW5kbGVyLlxuY29uc3QgUGFja2FnZSA9IHsgdmVyc2lvbjogcHJvY2Vzcy5lbnYuTUlOSU9fSlNfUEFDS0FHRV9WRVJTSU9OIHx8ICdkZXZlbG9wbWVudCcgfVxuXG5jb25zdCByZXF1ZXN0T3B0aW9uUHJvcGVydGllcyA9IFtcbiAgJ2FnZW50JyxcbiAgJ2NhJyxcbiAgJ2NlcnQnLFxuICAnY2lwaGVycycsXG4gICdjbGllbnRDZXJ0RW5naW5lJyxcbiAgJ2NybCcsXG4gICdkaHBhcmFtJyxcbiAgJ2VjZGhDdXJ2ZScsXG4gICdmYW1pbHknLFxuICAnaG9ub3JDaXBoZXJPcmRlcicsXG4gICdrZXknLFxuICAncGFzc3BocmFzZScsXG4gICdwZngnLFxuICAncmVqZWN0VW5hdXRob3JpemVkJyxcbiAgJ3NlY3VyZU9wdGlvbnMnLFxuICAnc2VjdXJlUHJvdG9jb2wnLFxuICAnc2VydmVybmFtZScsXG4gICdzZXNzaW9uSWRDb250ZXh0Jyxcbl0gYXMgY29uc3RcblxuZXhwb3J0IGludGVyZmFjZSBDbGllbnRPcHRpb25zIHtcbiAgZW5kUG9pbnQ6IHN0cmluZ1xuICBhY2Nlc3NLZXk/OiBzdHJpbmdcbiAgc2VjcmV0S2V5Pzogc3RyaW5nXG4gIHVzZVNTTD86IGJvb2xlYW5cbiAgcG9ydD86IG51bWJlclxuICByZWdpb24/OiBSZWdpb25cbiAgdHJhbnNwb3J0PzogVHJhbnNwb3J0XG4gIHNlc3Npb25Ub2tlbj86IHN0cmluZ1xuICBwYXJ0U2l6ZT86IG51bWJlclxuICBwYXRoU3R5bGU/OiBib29sZWFuXG4gIGNyZWRlbnRpYWxzUHJvdmlkZXI/OiBDcmVkZW50aWFsUHJvdmlkZXJcbiAgczNBY2NlbGVyYXRlRW5kcG9pbnQ/OiBzdHJpbmdcbiAgdHJhbnNwb3J0QWdlbnQ/OiBodHRwLkFnZW50XG59XG5cbmV4cG9ydCB0eXBlIFJlcXVlc3RPcHRpb24gPSBQYXJ0aWFsPElSZXF1ZXN0PiAmIHtcbiAgbWV0aG9kOiBzdHJpbmdcbiAgYnVja2V0TmFtZT86IHN0cmluZ1xuICBvYmplY3ROYW1lPzogc3RyaW5nXG4gIHF1ZXJ5Pzogc3RyaW5nXG4gIHBhdGhTdHlsZT86IGJvb2xlYW5cbn1cblxuZXhwb3J0IHR5cGUgTm9SZXN1bHRDYWxsYmFjayA9IChlcnJvcjogdW5rbm93bikgPT4gdm9pZFxuXG5leHBvcnQgaW50ZXJmYWNlIE1ha2VCdWNrZXRPcHQge1xuICBPYmplY3RMb2NraW5nPzogYm9vbGVhblxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlbW92ZU9wdGlvbnMge1xuICB2ZXJzaW9uSWQ/OiBzdHJpbmdcbiAgZ292ZXJuYW5jZUJ5cGFzcz86IGJvb2xlYW5cbiAgZm9yY2VEZWxldGU/OiBib29sZWFuXG59XG5cbnR5cGUgUGFydCA9IHtcbiAgcGFydDogbnVtYmVyXG4gIGV0YWc6IHN0cmluZ1xufVxuXG5leHBvcnQgY2xhc3MgVHlwZWRDbGllbnQge1xuICBwcm90ZWN0ZWQgdHJhbnNwb3J0OiBUcmFuc3BvcnRcbiAgcHJvdGVjdGVkIGhvc3Q6IHN0cmluZ1xuICBwcm90ZWN0ZWQgcG9ydDogbnVtYmVyXG4gIHByb3RlY3RlZCBwcm90b2NvbDogc3RyaW5nXG4gIHByb3RlY3RlZCBhY2Nlc3NLZXk6IHN0cmluZ1xuICBwcm90ZWN0ZWQgc2VjcmV0S2V5OiBzdHJpbmdcbiAgcHJvdGVjdGVkIHNlc3Npb25Ub2tlbj86IHN0cmluZ1xuICBwcm90ZWN0ZWQgdXNlckFnZW50OiBzdHJpbmdcbiAgcHJvdGVjdGVkIGFub255bW91czogYm9vbGVhblxuICBwcm90ZWN0ZWQgcGF0aFN0eWxlOiBib29sZWFuXG4gIHByb3RlY3RlZCByZWdpb25NYXA6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cbiAgcHVibGljIHJlZ2lvbj86IHN0cmluZ1xuICBwcm90ZWN0ZWQgY3JlZGVudGlhbHNQcm92aWRlcj86IENyZWRlbnRpYWxQcm92aWRlclxuICBwYXJ0U2l6ZTogbnVtYmVyID0gNjQgKiAxMDI0ICogMTAyNFxuICBwcm90ZWN0ZWQgb3ZlclJpZGVQYXJ0U2l6ZT86IGJvb2xlYW5cblxuICBwcm90ZWN0ZWQgbWF4aW11bVBhcnRTaXplID0gNSAqIDEwMjQgKiAxMDI0ICogMTAyNFxuICBwcm90ZWN0ZWQgbWF4T2JqZWN0U2l6ZSA9IDUgKiAxMDI0ICogMTAyNCAqIDEwMjQgKiAxMDI0XG4gIHB1YmxpYyBlbmFibGVTSEEyNTY6IGJvb2xlYW5cbiAgcHJvdGVjdGVkIHMzQWNjZWxlcmF0ZUVuZHBvaW50Pzogc3RyaW5nXG4gIHByb3RlY3RlZCByZXFPcHRpb25zOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuXG4gIHByb3RlY3RlZCB0cmFuc3BvcnRBZ2VudDogaHR0cC5BZ2VudFxuICBwcml2YXRlIHJlYWRvbmx5IGNsaWVudEV4dGVuc2lvbnM6IEV4dGVuc2lvbnNcblxuICBjb25zdHJ1Y3RvcihwYXJhbXM6IENsaWVudE9wdGlvbnMpIHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yIGRlcHJlY2F0ZWQgcHJvcGVydHlcbiAgICBpZiAocGFyYW1zLnNlY3VyZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1wic2VjdXJlXCIgb3B0aW9uIGRlcHJlY2F0ZWQsIFwidXNlU1NMXCIgc2hvdWxkIGJlIHVzZWQgaW5zdGVhZCcpXG4gICAgfVxuICAgIC8vIERlZmF1bHQgdmFsdWVzIGlmIG5vdCBzcGVjaWZpZWQuXG4gICAgaWYgKHBhcmFtcy51c2VTU0wgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcGFyYW1zLnVzZVNTTCA9IHRydWVcbiAgICB9XG4gICAgaWYgKCFwYXJhbXMucG9ydCkge1xuICAgICAgcGFyYW1zLnBvcnQgPSAwXG4gICAgfVxuICAgIC8vIFZhbGlkYXRlIGlucHV0IHBhcmFtcy5cbiAgICBpZiAoIWlzVmFsaWRFbmRwb2ludChwYXJhbXMuZW5kUG9pbnQpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRFbmRwb2ludEVycm9yKGBJbnZhbGlkIGVuZFBvaW50IDogJHtwYXJhbXMuZW5kUG9pbnR9YClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkUG9ydChwYXJhbXMucG9ydCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgcG9ydCA6ICR7cGFyYW1zLnBvcnR9YClcbiAgICB9XG4gICAgaWYgKCFpc0Jvb2xlYW4ocGFyYW1zLnVzZVNTTCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgIGBJbnZhbGlkIHVzZVNTTCBmbGFnIHR5cGUgOiAke3BhcmFtcy51c2VTU0x9LCBleHBlY3RlZCB0byBiZSBvZiB0eXBlIFwiYm9vbGVhblwiYCxcbiAgICAgIClcbiAgICB9XG5cbiAgICAvLyBWYWxpZGF0ZSByZWdpb24gb25seSBpZiBpdHMgc2V0LlxuICAgIGlmIChwYXJhbXMucmVnaW9uKSB7XG4gICAgICBpZiAoIWlzU3RyaW5nKHBhcmFtcy5yZWdpb24pKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgcmVnaW9uIDogJHtwYXJhbXMucmVnaW9ufWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgaG9zdCA9IHBhcmFtcy5lbmRQb2ludC50b0xvd2VyQ2FzZSgpXG4gICAgbGV0IHBvcnQgPSBwYXJhbXMucG9ydFxuICAgIGxldCBwcm90b2NvbDogc3RyaW5nXG4gICAgbGV0IHRyYW5zcG9ydFxuICAgIGxldCB0cmFuc3BvcnRBZ2VudDogaHR0cC5BZ2VudFxuICAgIC8vIFZhbGlkYXRlIGlmIGNvbmZpZ3VyYXRpb24gaXMgbm90IHVzaW5nIFNTTFxuICAgIC8vIGZvciBjb25zdHJ1Y3RpbmcgcmVsZXZhbnQgZW5kcG9pbnRzLlxuICAgIGlmIChwYXJhbXMudXNlU1NMKSB7XG4gICAgICAvLyBEZWZhdWx0cyB0byBzZWN1cmUuXG4gICAgICB0cmFuc3BvcnQgPSBodHRwc1xuICAgICAgcHJvdG9jb2wgPSAnaHR0cHM6J1xuICAgICAgcG9ydCA9IHBvcnQgfHwgNDQzXG4gICAgICB0cmFuc3BvcnRBZ2VudCA9IGh0dHBzLmdsb2JhbEFnZW50XG4gICAgfSBlbHNlIHtcbiAgICAgIHRyYW5zcG9ydCA9IGh0dHBcbiAgICAgIHByb3RvY29sID0gJ2h0dHA6J1xuICAgICAgcG9ydCA9IHBvcnQgfHwgODBcbiAgICAgIHRyYW5zcG9ydEFnZW50ID0gaHR0cC5nbG9iYWxBZ2VudFxuICAgIH1cblxuICAgIC8vIGlmIGN1c3RvbSB0cmFuc3BvcnQgaXMgc2V0LCB1c2UgaXQuXG4gICAgaWYgKHBhcmFtcy50cmFuc3BvcnQpIHtcbiAgICAgIGlmICghaXNPYmplY3QocGFyYW1zLnRyYW5zcG9ydCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgICBgSW52YWxpZCB0cmFuc3BvcnQgdHlwZSA6ICR7cGFyYW1zLnRyYW5zcG9ydH0sIGV4cGVjdGVkIHRvIGJlIHR5cGUgXCJvYmplY3RcImAsXG4gICAgICAgIClcbiAgICAgIH1cbiAgICAgIHRyYW5zcG9ydCA9IHBhcmFtcy50cmFuc3BvcnRcbiAgICB9XG5cbiAgICAvLyBpZiBjdXN0b20gdHJhbnNwb3J0IGFnZW50IGlzIHNldCwgdXNlIGl0LlxuICAgIGlmIChwYXJhbXMudHJhbnNwb3J0QWdlbnQpIHtcbiAgICAgIGlmICghaXNPYmplY3QocGFyYW1zLnRyYW5zcG9ydEFnZW50KSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICAgIGBJbnZhbGlkIHRyYW5zcG9ydEFnZW50IHR5cGU6ICR7cGFyYW1zLnRyYW5zcG9ydEFnZW50fSwgZXhwZWN0ZWQgdG8gYmUgdHlwZSBcIm9iamVjdFwiYCxcbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICB0cmFuc3BvcnRBZ2VudCA9IHBhcmFtcy50cmFuc3BvcnRBZ2VudFxuICAgIH1cblxuICAgIC8vIFVzZXIgQWdlbnQgc2hvdWxkIGFsd2F5cyBmb2xsb3dpbmcgdGhlIGJlbG93IHN0eWxlLlxuICAgIC8vIFBsZWFzZSBvcGVuIGFuIGlzc3VlIHRvIGRpc2N1c3MgYW55IG5ldyBjaGFuZ2VzIGhlcmUuXG4gICAgLy9cbiAgICAvLyAgICAgICBNaW5JTyAoT1M7IEFSQ0gpIExJQi9WRVIgQVBQL1ZFUlxuICAgIC8vXG4gICAgY29uc3QgbGlicmFyeUNvbW1lbnRzID0gYCgke3Byb2Nlc3MucGxhdGZvcm19OyAke3Byb2Nlc3MuYXJjaH0pYFxuICAgIGNvbnN0IGxpYnJhcnlBZ2VudCA9IGBNaW5JTyAke2xpYnJhcnlDb21tZW50c30gbWluaW8tanMvJHtQYWNrYWdlLnZlcnNpb259YFxuICAgIC8vIFVzZXIgYWdlbnQgYmxvY2sgZW5kcy5cblxuICAgIHRoaXMudHJhbnNwb3J0ID0gdHJhbnNwb3J0XG4gICAgdGhpcy50cmFuc3BvcnRBZ2VudCA9IHRyYW5zcG9ydEFnZW50XG4gICAgdGhpcy5ob3N0ID0gaG9zdFxuICAgIHRoaXMucG9ydCA9IHBvcnRcbiAgICB0aGlzLnByb3RvY29sID0gcHJvdG9jb2xcbiAgICB0aGlzLnVzZXJBZ2VudCA9IGAke2xpYnJhcnlBZ2VudH1gXG5cbiAgICAvLyBEZWZhdWx0IHBhdGggc3R5bGUgaXMgdHJ1ZVxuICAgIGlmIChwYXJhbXMucGF0aFN0eWxlID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMucGF0aFN0eWxlID0gdHJ1ZVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnBhdGhTdHlsZSA9IHBhcmFtcy5wYXRoU3R5bGVcbiAgICB9XG5cbiAgICB0aGlzLmFjY2Vzc0tleSA9IHBhcmFtcy5hY2Nlc3NLZXkgPz8gJydcbiAgICB0aGlzLnNlY3JldEtleSA9IHBhcmFtcy5zZWNyZXRLZXkgPz8gJydcbiAgICB0aGlzLnNlc3Npb25Ub2tlbiA9IHBhcmFtcy5zZXNzaW9uVG9rZW5cbiAgICB0aGlzLmFub255bW91cyA9ICF0aGlzLmFjY2Vzc0tleSB8fCAhdGhpcy5zZWNyZXRLZXlcblxuICAgIGlmIChwYXJhbXMuY3JlZGVudGlhbHNQcm92aWRlcikge1xuICAgICAgdGhpcy5hbm9ueW1vdXMgPSBmYWxzZVxuICAgICAgdGhpcy5jcmVkZW50aWFsc1Byb3ZpZGVyID0gcGFyYW1zLmNyZWRlbnRpYWxzUHJvdmlkZXJcbiAgICB9XG5cbiAgICB0aGlzLnJlZ2lvbk1hcCA9IHt9XG4gICAgaWYgKHBhcmFtcy5yZWdpb24pIHtcbiAgICAgIHRoaXMucmVnaW9uID0gcGFyYW1zLnJlZ2lvblxuICAgIH1cblxuICAgIGlmIChwYXJhbXMucGFydFNpemUpIHtcbiAgICAgIHRoaXMucGFydFNpemUgPSBwYXJhbXMucGFydFNpemVcbiAgICAgIHRoaXMub3ZlclJpZGVQYXJ0U2l6ZSA9IHRydWVcbiAgICB9XG4gICAgaWYgKHRoaXMucGFydFNpemUgPCA1ICogMTAyNCAqIDEwMjQpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYFBhcnQgc2l6ZSBzaG91bGQgYmUgZ3JlYXRlciB0aGFuIDVNQmApXG4gICAgfVxuICAgIGlmICh0aGlzLnBhcnRTaXplID4gNSAqIDEwMjQgKiAxMDI0ICogMTAyNCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgUGFydCBzaXplIHNob3VsZCBiZSBsZXNzIHRoYW4gNUdCYClcbiAgICB9XG5cbiAgICAvLyBTSEEyNTYgaXMgZW5hYmxlZCBvbmx5IGZvciBhdXRoZW50aWNhdGVkIGh0dHAgcmVxdWVzdHMuIElmIHRoZSByZXF1ZXN0IGlzIGF1dGhlbnRpY2F0ZWRcbiAgICAvLyBhbmQgdGhlIGNvbm5lY3Rpb24gaXMgaHR0cHMgd2UgdXNlIHgtYW16LWNvbnRlbnQtc2hhMjU2PVVOU0lHTkVELVBBWUxPQURcbiAgICAvLyBoZWFkZXIgZm9yIHNpZ25hdHVyZSBjYWxjdWxhdGlvbi5cbiAgICB0aGlzLmVuYWJsZVNIQTI1NiA9ICF0aGlzLmFub255bW91cyAmJiAhcGFyYW1zLnVzZVNTTFxuXG4gICAgdGhpcy5zM0FjY2VsZXJhdGVFbmRwb2ludCA9IHBhcmFtcy5zM0FjY2VsZXJhdGVFbmRwb2ludCB8fCB1bmRlZmluZWRcbiAgICB0aGlzLnJlcU9wdGlvbnMgPSB7fVxuICAgIHRoaXMuY2xpZW50RXh0ZW5zaW9ucyA9IG5ldyBFeHRlbnNpb25zKHRoaXMpXG4gIH1cbiAgLyoqXG4gICAqIE1pbmlvIGV4dGVuc2lvbnMgdGhhdCBhcmVuJ3QgbmVjZXNzYXJ5IHByZXNlbnQgZm9yIEFtYXpvbiBTMyBjb21wYXRpYmxlIHN0b3JhZ2Ugc2VydmVyc1xuICAgKi9cbiAgZ2V0IGV4dGVuc2lvbnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuY2xpZW50RXh0ZW5zaW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIEBwYXJhbSBlbmRQb2ludCAtIHZhbGlkIFMzIGFjY2VsZXJhdGlvbiBlbmQgcG9pbnRcbiAgICovXG4gIHNldFMzVHJhbnNmZXJBY2NlbGVyYXRlKGVuZFBvaW50OiBzdHJpbmcpIHtcbiAgICB0aGlzLnMzQWNjZWxlcmF0ZUVuZHBvaW50ID0gZW5kUG9pbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIHRoZSBzdXBwb3J0ZWQgcmVxdWVzdCBvcHRpb25zLlxuICAgKi9cbiAgcHVibGljIHNldFJlcXVlc3RPcHRpb25zKG9wdGlvbnM6IFBpY2s8aHR0cHMuUmVxdWVzdE9wdGlvbnMsICh0eXBlb2YgcmVxdWVzdE9wdGlvblByb3BlcnRpZXMpW251bWJlcl0+KSB7XG4gICAgaWYgKCFpc09iamVjdChvcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVxdWVzdCBvcHRpb25zIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICB0aGlzLnJlcU9wdGlvbnMgPSBfLnBpY2sob3B0aW9ucywgcmVxdWVzdE9wdGlvblByb3BlcnRpZXMpXG4gIH1cblxuICAvKipcbiAgICogIFRoaXMgaXMgczMgU3BlY2lmaWMgYW5kIGRvZXMgbm90IGhvbGQgdmFsaWRpdHkgaW4gYW55IG90aGVyIE9iamVjdCBzdG9yYWdlLlxuICAgKi9cbiAgcHJpdmF0ZSBnZXRBY2NlbGVyYXRlRW5kUG9pbnRJZlNldChidWNrZXROYW1lPzogc3RyaW5nLCBvYmplY3ROYW1lPzogc3RyaW5nKSB7XG4gICAgaWYgKCFpc0VtcHR5KHRoaXMuczNBY2NlbGVyYXRlRW5kcG9pbnQpICYmICFpc0VtcHR5KGJ1Y2tldE5hbWUpICYmICFpc0VtcHR5KG9iamVjdE5hbWUpKSB7XG4gICAgICAvLyBodHRwOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9BbWF6b25TMy9sYXRlc3QvZGV2L3RyYW5zZmVyLWFjY2VsZXJhdGlvbi5odG1sXG4gICAgICAvLyBEaXNhYmxlIHRyYW5zZmVyIGFjY2VsZXJhdGlvbiBmb3Igbm9uLWNvbXBsaWFudCBidWNrZXQgbmFtZXMuXG4gICAgICBpZiAoYnVja2V0TmFtZS5pbmNsdWRlcygnLicpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVHJhbnNmZXIgQWNjZWxlcmF0aW9uIGlzIG5vdCBzdXBwb3J0ZWQgZm9yIG5vbiBjb21wbGlhbnQgYnVja2V0OiR7YnVja2V0TmFtZX1gKVxuICAgICAgfVxuICAgICAgLy8gSWYgdHJhbnNmZXIgYWNjZWxlcmF0aW9uIGlzIHJlcXVlc3RlZCBzZXQgbmV3IGhvc3QuXG4gICAgICAvLyBGb3IgbW9yZSBkZXRhaWxzIGFib3V0IGVuYWJsaW5nIHRyYW5zZmVyIGFjY2VsZXJhdGlvbiByZWFkIGhlcmUuXG4gICAgICAvLyBodHRwOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9BbWF6b25TMy9sYXRlc3QvZGV2L3RyYW5zZmVyLWFjY2VsZXJhdGlvbi5odG1sXG4gICAgICByZXR1cm4gdGhpcy5zM0FjY2VsZXJhdGVFbmRwb2ludFxuICAgIH1cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiAgIFNldCBhcHBsaWNhdGlvbiBzcGVjaWZpYyBpbmZvcm1hdGlvbi5cbiAgICogICBHZW5lcmF0ZXMgVXNlci1BZ2VudCBpbiB0aGUgZm9sbG93aW5nIHN0eWxlLlxuICAgKiAgIE1pbklPIChPUzsgQVJDSCkgTElCL1ZFUiBBUFAvVkVSXG4gICAqL1xuICBzZXRBcHBJbmZvKGFwcE5hbWU6IHN0cmluZywgYXBwVmVyc2lvbjogc3RyaW5nKSB7XG4gICAgaWYgKCFpc1N0cmluZyhhcHBOYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgSW52YWxpZCBhcHBOYW1lOiAke2FwcE5hbWV9YClcbiAgICB9XG4gICAgaWYgKGFwcE5hbWUudHJpbSgpID09PSAnJykge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW5wdXQgYXBwTmFtZSBjYW5ub3QgYmUgZW1wdHkuJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhhcHBWZXJzaW9uKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgSW52YWxpZCBhcHBWZXJzaW9uOiAke2FwcFZlcnNpb259YClcbiAgICB9XG4gICAgaWYgKGFwcFZlcnNpb24udHJpbSgpID09PSAnJykge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW5wdXQgYXBwVmVyc2lvbiBjYW5ub3QgYmUgZW1wdHkuJylcbiAgICB9XG4gICAgdGhpcy51c2VyQWdlbnQgPSBgJHt0aGlzLnVzZXJBZ2VudH0gJHthcHBOYW1lfS8ke2FwcFZlcnNpb259YFxuICB9XG5cbiAgLyoqXG4gICAqIHJldHVybnMgb3B0aW9ucyBvYmplY3QgdGhhdCBjYW4gYmUgdXNlZCB3aXRoIGh0dHAucmVxdWVzdCgpXG4gICAqIFRha2VzIGNhcmUgb2YgY29uc3RydWN0aW5nIHZpcnR1YWwtaG9zdC1zdHlsZSBvciBwYXRoLXN0eWxlIGhvc3RuYW1lXG4gICAqL1xuICBwcm90ZWN0ZWQgZ2V0UmVxdWVzdE9wdGlvbnMoXG4gICAgb3B0czogUmVxdWVzdE9wdGlvbiAmIHtcbiAgICAgIHJlZ2lvbjogc3RyaW5nXG4gICAgfSxcbiAgKTogSVJlcXVlc3QgJiB7XG4gICAgaG9zdDogc3RyaW5nXG4gICAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxuICB9IHtcbiAgICBjb25zdCBtZXRob2QgPSBvcHRzLm1ldGhvZFxuICAgIGNvbnN0IHJlZ2lvbiA9IG9wdHMucmVnaW9uXG4gICAgY29uc3QgYnVja2V0TmFtZSA9IG9wdHMuYnVja2V0TmFtZVxuICAgIGxldCBvYmplY3ROYW1lID0gb3B0cy5vYmplY3ROYW1lXG4gICAgY29uc3QgaGVhZGVycyA9IG9wdHMuaGVhZGVyc1xuICAgIGNvbnN0IHF1ZXJ5ID0gb3B0cy5xdWVyeVxuXG4gICAgbGV0IHJlcU9wdGlvbnMgPSB7XG4gICAgICBtZXRob2QsXG4gICAgICBoZWFkZXJzOiB7fSBhcyBSZXF1ZXN0SGVhZGVycyxcbiAgICAgIHByb3RvY29sOiB0aGlzLnByb3RvY29sLFxuICAgICAgLy8gSWYgY3VzdG9tIHRyYW5zcG9ydEFnZW50IHdhcyBzdXBwbGllZCBlYXJsaWVyLCB3ZSdsbCBpbmplY3QgaXQgaGVyZVxuICAgICAgYWdlbnQ6IHRoaXMudHJhbnNwb3J0QWdlbnQsXG4gICAgfVxuXG4gICAgLy8gVmVyaWZ5IGlmIHZpcnR1YWwgaG9zdCBzdXBwb3J0ZWQuXG4gICAgbGV0IHZpcnR1YWxIb3N0U3R5bGVcbiAgICBpZiAoYnVja2V0TmFtZSkge1xuICAgICAgdmlydHVhbEhvc3RTdHlsZSA9IGlzVmlydHVhbEhvc3RTdHlsZSh0aGlzLmhvc3QsIHRoaXMucHJvdG9jb2wsIGJ1Y2tldE5hbWUsIHRoaXMucGF0aFN0eWxlKVxuICAgIH1cblxuICAgIGxldCBwYXRoID0gJy8nXG4gICAgbGV0IGhvc3QgPSB0aGlzLmhvc3RcblxuICAgIGxldCBwb3J0OiB1bmRlZmluZWQgfCBudW1iZXJcbiAgICBpZiAodGhpcy5wb3J0KSB7XG4gICAgICBwb3J0ID0gdGhpcy5wb3J0XG4gICAgfVxuXG4gICAgaWYgKG9iamVjdE5hbWUpIHtcbiAgICAgIG9iamVjdE5hbWUgPSB1cmlSZXNvdXJjZUVzY2FwZShvYmplY3ROYW1lKVxuICAgIH1cblxuICAgIC8vIEZvciBBbWF6b24gUzMgZW5kcG9pbnQsIGdldCBlbmRwb2ludCBiYXNlZCBvbiByZWdpb24uXG4gICAgaWYgKGlzQW1hem9uRW5kcG9pbnQoaG9zdCkpIHtcbiAgICAgIGNvbnN0IGFjY2VsZXJhdGVFbmRQb2ludCA9IHRoaXMuZ2V0QWNjZWxlcmF0ZUVuZFBvaW50SWZTZXQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSlcbiAgICAgIGlmIChhY2NlbGVyYXRlRW5kUG9pbnQpIHtcbiAgICAgICAgaG9zdCA9IGAke2FjY2VsZXJhdGVFbmRQb2ludH1gXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBob3N0ID0gZ2V0UzNFbmRwb2ludChyZWdpb24pXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHZpcnR1YWxIb3N0U3R5bGUgJiYgIW9wdHMucGF0aFN0eWxlKSB7XG4gICAgICAvLyBGb3IgYWxsIGhvc3RzIHdoaWNoIHN1cHBvcnQgdmlydHVhbCBob3N0IHN0eWxlLCBgYnVja2V0TmFtZWBcbiAgICAgIC8vIGlzIHBhcnQgb2YgdGhlIGhvc3RuYW1lIGluIHRoZSBmb2xsb3dpbmcgZm9ybWF0OlxuICAgICAgLy9cbiAgICAgIC8vICB2YXIgaG9zdCA9ICdidWNrZXROYW1lLmV4YW1wbGUuY29tJ1xuICAgICAgLy9cbiAgICAgIGlmIChidWNrZXROYW1lKSB7XG4gICAgICAgIGhvc3QgPSBgJHtidWNrZXROYW1lfS4ke2hvc3R9YFxuICAgICAgfVxuICAgICAgaWYgKG9iamVjdE5hbWUpIHtcbiAgICAgICAgcGF0aCA9IGAvJHtvYmplY3ROYW1lfWBcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRm9yIGFsbCBTMyBjb21wYXRpYmxlIHN0b3JhZ2Ugc2VydmljZXMgd2Ugd2lsbCBmYWxsYmFjayB0b1xuICAgICAgLy8gcGF0aCBzdHlsZSByZXF1ZXN0cywgd2hlcmUgYGJ1Y2tldE5hbWVgIGlzIHBhcnQgb2YgdGhlIFVSSVxuICAgICAgLy8gcGF0aC5cbiAgICAgIGlmIChidWNrZXROYW1lKSB7XG4gICAgICAgIHBhdGggPSBgLyR7YnVja2V0TmFtZX1gXG4gICAgICB9XG4gICAgICBpZiAob2JqZWN0TmFtZSkge1xuICAgICAgICBwYXRoID0gYC8ke2J1Y2tldE5hbWV9LyR7b2JqZWN0TmFtZX1gXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHF1ZXJ5KSB7XG4gICAgICBwYXRoICs9IGA/JHtxdWVyeX1gXG4gICAgfVxuICAgIHJlcU9wdGlvbnMuaGVhZGVycy5ob3N0ID0gaG9zdFxuICAgIGlmICgocmVxT3B0aW9ucy5wcm90b2NvbCA9PT0gJ2h0dHA6JyAmJiBwb3J0ICE9PSA4MCkgfHwgKHJlcU9wdGlvbnMucHJvdG9jb2wgPT09ICdodHRwczonICYmIHBvcnQgIT09IDQ0MykpIHtcbiAgICAgIHJlcU9wdGlvbnMuaGVhZGVycy5ob3N0ID0gam9pbkhvc3RQb3J0KGhvc3QsIHBvcnQpXG4gICAgfVxuXG4gICAgcmVxT3B0aW9ucy5oZWFkZXJzWyd1c2VyLWFnZW50J10gPSB0aGlzLnVzZXJBZ2VudFxuICAgIGlmIChoZWFkZXJzKSB7XG4gICAgICAvLyBoYXZlIGFsbCBoZWFkZXIga2V5cyBpbiBsb3dlciBjYXNlIC0gdG8gbWFrZSBzaWduaW5nIGVhc3lcbiAgICAgIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKGhlYWRlcnMpKSB7XG4gICAgICAgIHJlcU9wdGlvbnMuaGVhZGVyc1trLnRvTG93ZXJDYXNlKCldID0gdlxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFVzZSBhbnkgcmVxdWVzdCBvcHRpb24gc3BlY2lmaWVkIGluIG1pbmlvQ2xpZW50LnNldFJlcXVlc3RPcHRpb25zKClcbiAgICByZXFPcHRpb25zID0gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5yZXFPcHRpb25zLCByZXFPcHRpb25zKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnJlcU9wdGlvbnMsXG4gICAgICBoZWFkZXJzOiBfLm1hcFZhbHVlcyhfLnBpY2tCeShyZXFPcHRpb25zLmhlYWRlcnMsIGlzRGVmaW5lZCksICh2KSA9PiB2LnRvU3RyaW5nKCkpLFxuICAgICAgaG9zdCxcbiAgICAgIHBvcnQsXG4gICAgICBwYXRoLFxuICAgIH0gc2F0aXNmaWVzIGh0dHBzLlJlcXVlc3RPcHRpb25zXG4gIH1cblxuICBwdWJsaWMgYXN5bmMgc2V0Q3JlZGVudGlhbHNQcm92aWRlcihjcmVkZW50aWFsc1Byb3ZpZGVyOiBDcmVkZW50aWFsUHJvdmlkZXIpIHtcbiAgICBpZiAoIShjcmVkZW50aWFsc1Byb3ZpZGVyIGluc3RhbmNlb2YgQ3JlZGVudGlhbFByb3ZpZGVyKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmFibGUgdG8gZ2V0IGNyZWRlbnRpYWxzLiBFeHBlY3RlZCBpbnN0YW5jZSBvZiBDcmVkZW50aWFsUHJvdmlkZXInKVxuICAgIH1cbiAgICB0aGlzLmNyZWRlbnRpYWxzUHJvdmlkZXIgPSBjcmVkZW50aWFsc1Byb3ZpZGVyXG4gICAgYXdhaXQgdGhpcy5jaGVja0FuZFJlZnJlc2hDcmVkcygpXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNoZWNrQW5kUmVmcmVzaENyZWRzKCkge1xuICAgIGlmICh0aGlzLmNyZWRlbnRpYWxzUHJvdmlkZXIpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGNyZWRlbnRpYWxzQ29uZiA9IGF3YWl0IHRoaXMuY3JlZGVudGlhbHNQcm92aWRlci5nZXRDcmVkZW50aWFscygpXG4gICAgICAgIHRoaXMuYWNjZXNzS2V5ID0gY3JlZGVudGlhbHNDb25mLmdldEFjY2Vzc0tleSgpXG4gICAgICAgIHRoaXMuc2VjcmV0S2V5ID0gY3JlZGVudGlhbHNDb25mLmdldFNlY3JldEtleSgpXG4gICAgICAgIHRoaXMuc2Vzc2lvblRva2VuID0gY3JlZGVudGlhbHNDb25mLmdldFNlc3Npb25Ub2tlbigpXG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGdldCBjcmVkZW50aWFsczogJHtlfWAsIHsgY2F1c2U6IGUgfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGxvZ1N0cmVhbT86IHN0cmVhbS5Xcml0YWJsZVxuXG4gIC8qKlxuICAgKiBsb2cgdGhlIHJlcXVlc3QsIHJlc3BvbnNlLCBlcnJvclxuICAgKi9cbiAgcHJpdmF0ZSBsb2dIVFRQKHJlcU9wdGlvbnM6IElSZXF1ZXN0LCByZXNwb25zZTogaHR0cC5JbmNvbWluZ01lc3NhZ2UgfCBudWxsLCBlcnI/OiB1bmtub3duKSB7XG4gICAgLy8gaWYgbm8gbG9nU3RyZWFtIGF2YWlsYWJsZSByZXR1cm4uXG4gICAgaWYgKCF0aGlzLmxvZ1N0cmVhbSkge1xuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QocmVxT3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlcU9wdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmIChyZXNwb25zZSAmJiAhaXNSZWFkYWJsZVN0cmVhbShyZXNwb25zZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3Jlc3BvbnNlIHNob3VsZCBiZSBvZiB0eXBlIFwiU3RyZWFtXCInKVxuICAgIH1cbiAgICBpZiAoZXJyICYmICEoZXJyIGluc3RhbmNlb2YgRXJyb3IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdlcnIgc2hvdWxkIGJlIG9mIHR5cGUgXCJFcnJvclwiJylcbiAgICB9XG4gICAgY29uc3QgbG9nU3RyZWFtID0gdGhpcy5sb2dTdHJlYW1cbiAgICBjb25zdCBsb2dIZWFkZXJzID0gKGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzKSA9PiB7XG4gICAgICBPYmplY3QuZW50cmllcyhoZWFkZXJzKS5mb3JFYWNoKChbaywgdl0pID0+IHtcbiAgICAgICAgaWYgKGsgPT0gJ2F1dGhvcml6YXRpb24nKSB7XG4gICAgICAgICAgaWYgKGlzU3RyaW5nKHYpKSB7XG4gICAgICAgICAgICBjb25zdCByZWRhY3RvciA9IG5ldyBSZWdFeHAoJ1NpZ25hdHVyZT0oWzAtOWEtZl0rKScpXG4gICAgICAgICAgICB2ID0gdi5yZXBsYWNlKHJlZGFjdG9yLCAnU2lnbmF0dXJlPSoqUkVEQUNURUQqKicpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGxvZ1N0cmVhbS53cml0ZShgJHtrfTogJHt2fVxcbmApXG4gICAgICB9KVxuICAgICAgbG9nU3RyZWFtLndyaXRlKCdcXG4nKVxuICAgIH1cbiAgICBsb2dTdHJlYW0ud3JpdGUoYFJFUVVFU1Q6ICR7cmVxT3B0aW9ucy5tZXRob2R9ICR7cmVxT3B0aW9ucy5wYXRofVxcbmApXG4gICAgbG9nSGVhZGVycyhyZXFPcHRpb25zLmhlYWRlcnMpXG4gICAgaWYgKHJlc3BvbnNlKSB7XG4gICAgICB0aGlzLmxvZ1N0cmVhbS53cml0ZShgUkVTUE9OU0U6ICR7cmVzcG9uc2Uuc3RhdHVzQ29kZX1cXG5gKVxuICAgICAgbG9nSGVhZGVycyhyZXNwb25zZS5oZWFkZXJzIGFzIFJlcXVlc3RIZWFkZXJzKVxuICAgIH1cbiAgICBpZiAoZXJyKSB7XG4gICAgICBsb2dTdHJlYW0ud3JpdGUoJ0VSUk9SIEJPRFk6XFxuJylcbiAgICAgIGNvbnN0IGVyckpTT04gPSBKU09OLnN0cmluZ2lmeShlcnIsIG51bGwsICdcXHQnKVxuICAgICAgbG9nU3RyZWFtLndyaXRlKGAke2VyckpTT059XFxuYClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5hYmxlIHRyYWNpbmdcbiAgICovXG4gIHB1YmxpYyB0cmFjZU9uKHN0cmVhbT86IHN0cmVhbS5Xcml0YWJsZSkge1xuICAgIGlmICghc3RyZWFtKSB7XG4gICAgICBzdHJlYW0gPSBwcm9jZXNzLnN0ZG91dFxuICAgIH1cbiAgICB0aGlzLmxvZ1N0cmVhbSA9IHN0cmVhbVxuICB9XG5cbiAgLyoqXG4gICAqIERpc2FibGUgdHJhY2luZ1xuICAgKi9cbiAgcHVibGljIHRyYWNlT2ZmKCkge1xuICAgIHRoaXMubG9nU3RyZWFtID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogbWFrZVJlcXVlc3QgaXMgdGhlIHByaW1pdGl2ZSB1c2VkIGJ5IHRoZSBhcGlzIGZvciBtYWtpbmcgUzMgcmVxdWVzdHMuXG4gICAqIHBheWxvYWQgY2FuIGJlIGVtcHR5IHN0cmluZyBpbiBjYXNlIG9mIG5vIHBheWxvYWQuXG4gICAqIHN0YXR1c0NvZGUgaXMgdGhlIGV4cGVjdGVkIHN0YXR1c0NvZGUuIElmIHJlc3BvbnNlLnN0YXR1c0NvZGUgZG9lcyBub3QgbWF0Y2hcbiAgICogd2UgcGFyc2UgdGhlIFhNTCBlcnJvciBhbmQgY2FsbCB0aGUgY2FsbGJhY2sgd2l0aCB0aGUgZXJyb3IgbWVzc2FnZS5cbiAgICpcbiAgICogQSB2YWxpZCByZWdpb24gaXMgcGFzc2VkIGJ5IHRoZSBjYWxscyAtIGxpc3RCdWNrZXRzLCBtYWtlQnVja2V0IGFuZCBnZXRCdWNrZXRSZWdpb24uXG4gICAqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgYXN5bmMgbWFrZVJlcXVlc3RBc3luYyhcbiAgICBvcHRpb25zOiBSZXF1ZXN0T3B0aW9uLFxuICAgIHBheWxvYWQ6IEJpbmFyeSA9ICcnLFxuICAgIGV4cGVjdGVkQ29kZXM6IG51bWJlcltdID0gWzIwMF0sXG4gICAgcmVnaW9uID0gJycsXG4gICk6IFByb21pc2U8aHR0cC5JbmNvbWluZ01lc3NhZ2U+IHtcbiAgICBpZiAoIWlzT2JqZWN0KG9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvcHRpb25zIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHBheWxvYWQpICYmICFpc09iamVjdChwYXlsb2FkKSkge1xuICAgICAgLy8gQnVmZmVyIGlzIG9mIHR5cGUgJ29iamVjdCdcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3BheWxvYWQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIiBvciBcIkJ1ZmZlclwiJylcbiAgICB9XG4gICAgZXhwZWN0ZWRDb2Rlcy5mb3JFYWNoKChzdGF0dXNDb2RlKSA9PiB7XG4gICAgICBpZiAoIWlzTnVtYmVyKHN0YXR1c0NvZGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N0YXR1c0NvZGUgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgICB9XG4gICAgfSlcbiAgICBpZiAoIWlzU3RyaW5nKHJlZ2lvbikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlZ2lvbiBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFvcHRpb25zLmhlYWRlcnMpIHtcbiAgICAgIG9wdGlvbnMuaGVhZGVycyA9IHt9XG4gICAgfVxuICAgIGlmIChvcHRpb25zLm1ldGhvZCA9PT0gJ1BPU1QnIHx8IG9wdGlvbnMubWV0aG9kID09PSAnUFVUJyB8fCBvcHRpb25zLm1ldGhvZCA9PT0gJ0RFTEVURScpIHtcbiAgICAgIG9wdGlvbnMuaGVhZGVyc1snY29udGVudC1sZW5ndGgnXSA9IHBheWxvYWQubGVuZ3RoLnRvU3RyaW5nKClcbiAgICB9XG4gICAgY29uc3Qgc2hhMjU2c3VtID0gdGhpcy5lbmFibGVTSEEyNTYgPyB0b1NoYTI1NihwYXlsb2FkKSA6ICcnXG4gICAgcmV0dXJuIHRoaXMubWFrZVJlcXVlc3RTdHJlYW1Bc3luYyhvcHRpb25zLCBwYXlsb2FkLCBzaGEyNTZzdW0sIGV4cGVjdGVkQ29kZXMsIHJlZ2lvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBuZXcgcmVxdWVzdCB3aXRoIHByb21pc2VcbiAgICpcbiAgICogTm8gbmVlZCB0byBkcmFpbiByZXNwb25zZSwgcmVzcG9uc2UgYm9keSBpcyBub3QgdmFsaWRcbiAgICovXG4gIGFzeW5jIG1ha2VSZXF1ZXN0QXN5bmNPbWl0KFxuICAgIG9wdGlvbnM6IFJlcXVlc3RPcHRpb24sXG4gICAgcGF5bG9hZDogQmluYXJ5ID0gJycsXG4gICAgc3RhdHVzQ29kZXM6IG51bWJlcltdID0gWzIwMF0sXG4gICAgcmVnaW9uID0gJycsXG4gICk6IFByb21pc2U8T21pdDxodHRwLkluY29taW5nTWVzc2FnZSwgJ29uJz4+IHtcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMob3B0aW9ucywgcGF5bG9hZCwgc3RhdHVzQ29kZXMsIHJlZ2lvbilcbiAgICBhd2FpdCBkcmFpblJlc3BvbnNlKHJlcylcbiAgICByZXR1cm4gcmVzXG4gIH1cblxuICAvKipcbiAgICogbWFrZVJlcXVlc3RTdHJlYW0gd2lsbCBiZSB1c2VkIGRpcmVjdGx5IGluc3RlYWQgb2YgbWFrZVJlcXVlc3QgaW4gY2FzZSB0aGUgcGF5bG9hZFxuICAgKiBpcyBhdmFpbGFibGUgYXMgYSBzdHJlYW0uIGZvciBleC4gcHV0T2JqZWN0XG4gICAqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgYXN5bmMgbWFrZVJlcXVlc3RTdHJlYW1Bc3luYyhcbiAgICBvcHRpb25zOiBSZXF1ZXN0T3B0aW9uLFxuICAgIGJvZHk6IHN0cmVhbS5SZWFkYWJsZSB8IEJpbmFyeSxcbiAgICBzaGEyNTZzdW06IHN0cmluZyxcbiAgICBzdGF0dXNDb2RlczogbnVtYmVyW10sXG4gICAgcmVnaW9uOiBzdHJpbmcsXG4gICk6IFByb21pc2U8aHR0cC5JbmNvbWluZ01lc3NhZ2U+IHtcbiAgICBpZiAoIWlzT2JqZWN0KG9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvcHRpb25zIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoIShCdWZmZXIuaXNCdWZmZXIoYm9keSkgfHwgdHlwZW9mIGJvZHkgPT09ICdzdHJpbmcnIHx8IGlzUmVhZGFibGVTdHJlYW0oYm9keSkpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICBgc3RyZWFtIHNob3VsZCBiZSBhIEJ1ZmZlciwgc3RyaW5nIG9yIHJlYWRhYmxlIFN0cmVhbSwgZ290ICR7dHlwZW9mIGJvZHl9IGluc3RlYWRgLFxuICAgICAgKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHNoYTI1NnN1bSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NoYTI1NnN1bSBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgc3RhdHVzQ29kZXMuZm9yRWFjaCgoc3RhdHVzQ29kZSkgPT4ge1xuICAgICAgaWYgKCFpc051bWJlcihzdGF0dXNDb2RlKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzdGF0dXNDb2RlIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgICAgfVxuICAgIH0pXG4gICAgaWYgKCFpc1N0cmluZyhyZWdpb24pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWdpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIC8vIHNoYTI1NnN1bSB3aWxsIGJlIGVtcHR5IGZvciBhbm9ueW1vdXMgb3IgaHR0cHMgcmVxdWVzdHNcbiAgICBpZiAoIXRoaXMuZW5hYmxlU0hBMjU2ICYmIHNoYTI1NnN1bS5sZW5ndGggIT09IDApIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYHNoYTI1NnN1bSBleHBlY3RlZCB0byBiZSBlbXB0eSBmb3IgYW5vbnltb3VzIG9yIGh0dHBzIHJlcXVlc3RzYClcbiAgICB9XG4gICAgLy8gc2hhMjU2c3VtIHNob3VsZCBiZSB2YWxpZCBmb3Igbm9uLWFub255bW91cyBodHRwIHJlcXVlc3RzLlxuICAgIGlmICh0aGlzLmVuYWJsZVNIQTI1NiAmJiBzaGEyNTZzdW0ubGVuZ3RoICE9PSA2NCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCBzaGEyNTZzdW0gOiAke3NoYTI1NnN1bX1gKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuY2hlY2tBbmRSZWZyZXNoQ3JlZHMoKVxuXG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1ub24tbnVsbC1hc3NlcnRpb25cbiAgICByZWdpb24gPSByZWdpb24gfHwgKGF3YWl0IHRoaXMuZ2V0QnVja2V0UmVnaW9uQXN5bmMob3B0aW9ucy5idWNrZXROYW1lISkpXG5cbiAgICBjb25zdCByZXFPcHRpb25zID0gdGhpcy5nZXRSZXF1ZXN0T3B0aW9ucyh7IC4uLm9wdGlvbnMsIHJlZ2lvbiB9KVxuICAgIGlmICghdGhpcy5hbm9ueW1vdXMpIHtcbiAgICAgIC8vIEZvciBub24tYW5vbnltb3VzIGh0dHBzIHJlcXVlc3RzIHNoYTI1NnN1bSBpcyAnVU5TSUdORUQtUEFZTE9BRCcgZm9yIHNpZ25hdHVyZSBjYWxjdWxhdGlvbi5cbiAgICAgIGlmICghdGhpcy5lbmFibGVTSEEyNTYpIHtcbiAgICAgICAgc2hhMjU2c3VtID0gJ1VOU0lHTkVELVBBWUxPQUQnXG4gICAgICB9XG4gICAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoKVxuICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzWyd4LWFtei1kYXRlJ10gPSBtYWtlRGF0ZUxvbmcoZGF0ZSlcbiAgICAgIHJlcU9wdGlvbnMuaGVhZGVyc1sneC1hbXotY29udGVudC1zaGEyNTYnXSA9IHNoYTI1NnN1bVxuICAgICAgaWYgKHRoaXMuc2Vzc2lvblRva2VuKSB7XG4gICAgICAgIHJlcU9wdGlvbnMuaGVhZGVyc1sneC1hbXotc2VjdXJpdHktdG9rZW4nXSA9IHRoaXMuc2Vzc2lvblRva2VuXG4gICAgICB9XG4gICAgICByZXFPcHRpb25zLmhlYWRlcnMuYXV0aG9yaXphdGlvbiA9IHNpZ25WNChyZXFPcHRpb25zLCB0aGlzLmFjY2Vzc0tleSwgdGhpcy5zZWNyZXRLZXksIHJlZ2lvbiwgZGF0ZSwgc2hhMjU2c3VtKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcmVxdWVzdFdpdGhSZXRyeSh0aGlzLnRyYW5zcG9ydCwgcmVxT3B0aW9ucywgYm9keSlcbiAgICBpZiAoIXJlc3BvbnNlLnN0YXR1c0NvZGUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkJVRzogcmVzcG9uc2UgZG9lc24ndCBoYXZlIGEgc3RhdHVzQ29kZVwiKVxuICAgIH1cblxuICAgIGlmICghc3RhdHVzQ29kZXMuaW5jbHVkZXMocmVzcG9uc2Uuc3RhdHVzQ29kZSkpIHtcbiAgICAgIC8vIEZvciBhbiBpbmNvcnJlY3QgcmVnaW9uLCBTMyBzZXJ2ZXIgYWx3YXlzIHNlbmRzIGJhY2sgNDAwLlxuICAgICAgLy8gQnV0IHdlIHdpbGwgZG8gY2FjaGUgaW52YWxpZGF0aW9uIGZvciBhbGwgZXJyb3JzIHNvIHRoYXQsXG4gICAgICAvLyBpbiBmdXR1cmUsIGlmIEFXUyBTMyBkZWNpZGVzIHRvIHNlbmQgYSBkaWZmZXJlbnQgc3RhdHVzIGNvZGUgb3JcbiAgICAgIC8vIFhNTCBlcnJvciBjb2RlIHdlIHdpbGwgc3RpbGwgd29yayBmaW5lLlxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1ub24tbnVsbC1hc3NlcnRpb25cbiAgICAgIGRlbGV0ZSB0aGlzLnJlZ2lvbk1hcFtvcHRpb25zLmJ1Y2tldE5hbWUhXVxuXG4gICAgICBjb25zdCBlcnIgPSBhd2FpdCB4bWxQYXJzZXJzLnBhcnNlUmVzcG9uc2VFcnJvcihyZXNwb25zZSlcbiAgICAgIHRoaXMubG9nSFRUUChyZXFPcHRpb25zLCByZXNwb25zZSwgZXJyKVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuXG4gICAgdGhpcy5sb2dIVFRQKHJlcU9wdGlvbnMsIHJlc3BvbnNlKVxuXG4gICAgcmV0dXJuIHJlc3BvbnNlXG4gIH1cblxuICAvKipcbiAgICogZ2V0cyB0aGUgcmVnaW9uIG9mIHRoZSBidWNrZXRcbiAgICpcbiAgICogQHBhcmFtIGJ1Y2tldE5hbWVcbiAgICpcbiAgICogQGludGVybmFsXG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgZ2V0QnVja2V0UmVnaW9uQXN5bmMoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWUgOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG5cbiAgICAvLyBSZWdpb24gaXMgc2V0IHdpdGggY29uc3RydWN0b3IsIHJldHVybiB0aGUgcmVnaW9uIHJpZ2h0IGhlcmUuXG4gICAgaWYgKHRoaXMucmVnaW9uKSB7XG4gICAgICByZXR1cm4gdGhpcy5yZWdpb25cbiAgICB9XG5cbiAgICBjb25zdCBjYWNoZWQgPSB0aGlzLnJlZ2lvbk1hcFtidWNrZXROYW1lXVxuICAgIGlmIChjYWNoZWQpIHtcbiAgICAgIHJldHVybiBjYWNoZWRcbiAgICB9XG5cbiAgICBjb25zdCBleHRyYWN0UmVnaW9uQXN5bmMgPSBhc3luYyAocmVzcG9uc2U6IGh0dHAuSW5jb21pbmdNZXNzYWdlKSA9PiB7XG4gICAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlc3BvbnNlKVxuICAgICAgY29uc3QgcmVnaW9uID0geG1sUGFyc2Vycy5wYXJzZUJ1Y2tldFJlZ2lvbihib2R5KSB8fCBERUZBVUxUX1JFR0lPTlxuICAgICAgdGhpcy5yZWdpb25NYXBbYnVja2V0TmFtZV0gPSByZWdpb25cbiAgICAgIHJldHVybiByZWdpb25cbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2xvY2F0aW9uJ1xuICAgIC8vIGBnZXRCdWNrZXRMb2NhdGlvbmAgYmVoYXZlcyBkaWZmZXJlbnRseSBpbiBmb2xsb3dpbmcgd2F5cyBmb3JcbiAgICAvLyBkaWZmZXJlbnQgZW52aXJvbm1lbnRzLlxuICAgIC8vXG4gICAgLy8gLSBGb3Igbm9kZWpzIGVudiB3ZSBkZWZhdWx0IHRvIHBhdGggc3R5bGUgcmVxdWVzdHMuXG4gICAgLy8gLSBGb3IgYnJvd3NlciBlbnYgcGF0aCBzdHlsZSByZXF1ZXN0cyBvbiBidWNrZXRzIHlpZWxkcyBDT1JTXG4gICAgLy8gICBlcnJvci4gVG8gY2lyY3VtdmVudCB0aGlzIHByb2JsZW0gd2UgbWFrZSBhIHZpcnR1YWwgaG9zdFxuICAgIC8vICAgc3R5bGUgcmVxdWVzdCBzaWduZWQgd2l0aCAndXMtZWFzdC0xJy4gVGhpcyByZXF1ZXN0IGZhaWxzXG4gICAgLy8gICB3aXRoIGFuIGVycm9yICdBdXRob3JpemF0aW9uSGVhZGVyTWFsZm9ybWVkJywgYWRkaXRpb25hbGx5XG4gICAgLy8gICB0aGUgZXJyb3IgWE1MIGFsc28gcHJvdmlkZXMgUmVnaW9uIG9mIHRoZSBidWNrZXQuIFRvIHZhbGlkYXRlXG4gICAgLy8gICB0aGlzIHJlZ2lvbiBpcyBwcm9wZXIgd2UgcmV0cnkgdGhlIHNhbWUgcmVxdWVzdCB3aXRoIHRoZSBuZXdseVxuICAgIC8vICAgb2J0YWluZWQgcmVnaW9uLlxuICAgIGNvbnN0IHBhdGhTdHlsZSA9IHRoaXMucGF0aFN0eWxlICYmICFpc0Jyb3dzZXJcbiAgICBsZXQgcmVnaW9uOiBzdHJpbmdcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgcGF0aFN0eWxlIH0sICcnLCBbMjAwXSwgREVGQVVMVF9SRUdJT04pXG4gICAgICByZXR1cm4gZXh0cmFjdFJlZ2lvbkFzeW5jKHJlcylcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAvLyBtYWtlIGFsaWdubWVudCB3aXRoIG1jIGNsaVxuICAgICAgaWYgKGUgaW5zdGFuY2VvZiBlcnJvcnMuUzNFcnJvcikge1xuICAgICAgICBjb25zdCBlcnJDb2RlID0gZS5jb2RlXG4gICAgICAgIGNvbnN0IGVyclJlZ2lvbiA9IGUucmVnaW9uXG4gICAgICAgIGlmIChlcnJDb2RlID09PSAnQWNjZXNzRGVuaWVkJyAmJiAhZXJyUmVnaW9uKSB7XG4gICAgICAgICAgcmV0dXJuIERFRkFVTFRfUkVHSU9OXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgIGlmICghKGUubmFtZSA9PT0gJ0F1dGhvcml6YXRpb25IZWFkZXJNYWxmb3JtZWQnKSkge1xuICAgICAgICB0aHJvdyBlXG4gICAgICB9XG4gICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIHdlIHNldCBleHRyYSBwcm9wZXJ0aWVzIG9uIGVycm9yIG9iamVjdFxuICAgICAgcmVnaW9uID0gZS5SZWdpb24gYXMgc3RyaW5nXG4gICAgICBpZiAoIXJlZ2lvbikge1xuICAgICAgICB0aHJvdyBlXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgcGF0aFN0eWxlIH0sICcnLCBbMjAwXSwgcmVnaW9uKVxuICAgIHJldHVybiBhd2FpdCBleHRyYWN0UmVnaW9uQXN5bmMocmVzKVxuICB9XG5cbiAgLyoqXG4gICAqIG1ha2VSZXF1ZXN0IGlzIHRoZSBwcmltaXRpdmUgdXNlZCBieSB0aGUgYXBpcyBmb3IgbWFraW5nIFMzIHJlcXVlc3RzLlxuICAgKiBwYXlsb2FkIGNhbiBiZSBlbXB0eSBzdHJpbmcgaW4gY2FzZSBvZiBubyBwYXlsb2FkLlxuICAgKiBzdGF0dXNDb2RlIGlzIHRoZSBleHBlY3RlZCBzdGF0dXNDb2RlLiBJZiByZXNwb25zZS5zdGF0dXNDb2RlIGRvZXMgbm90IG1hdGNoXG4gICAqIHdlIHBhcnNlIHRoZSBYTUwgZXJyb3IgYW5kIGNhbGwgdGhlIGNhbGxiYWNrIHdpdGggdGhlIGVycm9yIG1lc3NhZ2UuXG4gICAqIEEgdmFsaWQgcmVnaW9uIGlzIHBhc3NlZCBieSB0aGUgY2FsbHMgLSBsaXN0QnVja2V0cywgbWFrZUJ1Y2tldCBhbmRcbiAgICogZ2V0QnVja2V0UmVnaW9uLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCB1c2UgYG1ha2VSZXF1ZXN0QXN5bmNgIGluc3RlYWRcbiAgICovXG4gIG1ha2VSZXF1ZXN0KFxuICAgIG9wdGlvbnM6IFJlcXVlc3RPcHRpb24sXG4gICAgcGF5bG9hZDogQmluYXJ5ID0gJycsXG4gICAgZXhwZWN0ZWRDb2RlczogbnVtYmVyW10gPSBbMjAwXSxcbiAgICByZWdpb24gPSAnJyxcbiAgICByZXR1cm5SZXNwb25zZTogYm9vbGVhbixcbiAgICBjYjogKGNiOiB1bmtub3duLCByZXN1bHQ6IGh0dHAuSW5jb21pbmdNZXNzYWdlKSA9PiB2b2lkLFxuICApIHtcbiAgICBsZXQgcHJvbTogUHJvbWlzZTxodHRwLkluY29taW5nTWVzc2FnZT5cbiAgICBpZiAocmV0dXJuUmVzcG9uc2UpIHtcbiAgICAgIHByb20gPSB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMob3B0aW9ucywgcGF5bG9hZCwgZXhwZWN0ZWRDb2RlcywgcmVnaW9uKVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIGNvbXBhdGlibGUgZm9yIG9sZCBiZWhhdmlvdXJcbiAgICAgIHByb20gPSB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KG9wdGlvbnMsIHBheWxvYWQsIGV4cGVjdGVkQ29kZXMsIHJlZ2lvbilcbiAgICB9XG5cbiAgICBwcm9tLnRoZW4oXG4gICAgICAocmVzdWx0KSA9PiBjYihudWxsLCByZXN1bHQpLFxuICAgICAgKGVycikgPT4ge1xuICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgY2IoZXJyKVxuICAgICAgfSxcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogbWFrZVJlcXVlc3RTdHJlYW0gd2lsbCBiZSB1c2VkIGRpcmVjdGx5IGluc3RlYWQgb2YgbWFrZVJlcXVlc3QgaW4gY2FzZSB0aGUgcGF5bG9hZFxuICAgKiBpcyBhdmFpbGFibGUgYXMgYSBzdHJlYW0uIGZvciBleC4gcHV0T2JqZWN0XG4gICAqXG4gICAqIEBkZXByZWNhdGVkIHVzZSBgbWFrZVJlcXVlc3RTdHJlYW1Bc3luY2AgaW5zdGVhZFxuICAgKi9cbiAgbWFrZVJlcXVlc3RTdHJlYW0oXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcbiAgICBzdHJlYW06IHN0cmVhbS5SZWFkYWJsZSB8IEJ1ZmZlcixcbiAgICBzaGEyNTZzdW06IHN0cmluZyxcbiAgICBzdGF0dXNDb2RlczogbnVtYmVyW10sXG4gICAgcmVnaW9uOiBzdHJpbmcsXG4gICAgcmV0dXJuUmVzcG9uc2U6IGJvb2xlYW4sXG4gICAgY2I6IChjYjogdW5rbm93biwgcmVzdWx0OiBodHRwLkluY29taW5nTWVzc2FnZSkgPT4gdm9pZCxcbiAgKSB7XG4gICAgY29uc3QgZXhlY3V0b3IgPSBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0U3RyZWFtQXN5bmMob3B0aW9ucywgc3RyZWFtLCBzaGEyNTZzdW0sIHN0YXR1c0NvZGVzLCByZWdpb24pXG4gICAgICBpZiAoIXJldHVyblJlc3BvbnNlKSB7XG4gICAgICAgIGF3YWl0IGRyYWluUmVzcG9uc2UocmVzKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzXG4gICAgfVxuXG4gICAgZXhlY3V0b3IoKS50aGVuKFxuICAgICAgKHJlc3VsdCkgPT4gY2IobnVsbCwgcmVzdWx0KSxcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgIChlcnIpID0+IGNiKGVyciksXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIEBkZXByZWNhdGVkIHVzZSBgZ2V0QnVja2V0UmVnaW9uQXN5bmNgIGluc3RlYWRcbiAgICovXG4gIGdldEJ1Y2tldFJlZ2lvbihidWNrZXROYW1lOiBzdHJpbmcsIGNiOiAoZXJyOiB1bmtub3duLCByZWdpb246IHN0cmluZykgPT4gdm9pZCkge1xuICAgIHJldHVybiB0aGlzLmdldEJ1Y2tldFJlZ2lvbkFzeW5jKGJ1Y2tldE5hbWUpLnRoZW4oXG4gICAgICAocmVzdWx0KSA9PiBjYihudWxsLCByZXN1bHQpLFxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgKGVycikgPT4gY2IoZXJyKSxcbiAgICApXG4gIH1cblxuICAvLyBCdWNrZXQgb3BlcmF0aW9uc1xuXG4gIC8qKlxuICAgKiBDcmVhdGVzIHRoZSBidWNrZXQgYGJ1Y2tldE5hbWVgLlxuICAgKlxuICAgKi9cbiAgYXN5bmMgbWFrZUJ1Y2tldChidWNrZXROYW1lOiBzdHJpbmcsIHJlZ2lvbjogUmVnaW9uID0gJycsIG1ha2VPcHRzPzogTWFrZUJ1Y2tldE9wdCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIC8vIEJhY2t3YXJkIENvbXBhdGliaWxpdHlcbiAgICBpZiAoaXNPYmplY3QocmVnaW9uKSkge1xuICAgICAgbWFrZU9wdHMgPSByZWdpb25cbiAgICAgIHJlZ2lvbiA9ICcnXG4gICAgfVxuXG4gICAgaWYgKCFpc1N0cmluZyhyZWdpb24pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWdpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmIChtYWtlT3B0cyAmJiAhaXNPYmplY3QobWFrZU9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtYWtlT3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICBsZXQgcGF5bG9hZCA9ICcnXG5cbiAgICAvLyBSZWdpb24gYWxyZWFkeSBzZXQgaW4gY29uc3RydWN0b3IsIHZhbGlkYXRlIGlmXG4gICAgLy8gY2FsbGVyIHJlcXVlc3RlZCBidWNrZXQgbG9jYXRpb24gaXMgc2FtZS5cbiAgICBpZiAocmVnaW9uICYmIHRoaXMucmVnaW9uKSB7XG4gICAgICBpZiAocmVnaW9uICE9PSB0aGlzLnJlZ2lvbikge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBDb25maWd1cmVkIHJlZ2lvbiAke3RoaXMucmVnaW9ufSwgcmVxdWVzdGVkICR7cmVnaW9ufWApXG4gICAgICB9XG4gICAgfVxuICAgIC8vIHNlbmRpbmcgbWFrZUJ1Y2tldCByZXF1ZXN0IHdpdGggWE1MIGNvbnRhaW5pbmcgJ3VzLWVhc3QtMScgZmFpbHMuIEZvclxuICAgIC8vIGRlZmF1bHQgcmVnaW9uIHNlcnZlciBleHBlY3RzIHRoZSByZXF1ZXN0IHdpdGhvdXQgYm9keVxuICAgIGlmIChyZWdpb24gJiYgcmVnaW9uICE9PSBERUZBVUxUX1JFR0lPTikge1xuICAgICAgcGF5bG9hZCA9IHhtbC5idWlsZE9iamVjdCh7XG4gICAgICAgIENyZWF0ZUJ1Y2tldENvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICAkOiB7IHhtbG5zOiAnaHR0cDovL3MzLmFtYXpvbmF3cy5jb20vZG9jLzIwMDYtMDMtMDEvJyB9LFxuICAgICAgICAgIExvY2F0aW9uQ29uc3RyYWludDogcmVnaW9uLFxuICAgICAgICB9LFxuICAgICAgfSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XG5cbiAgICBpZiAobWFrZU9wdHMgJiYgbWFrZU9wdHMuT2JqZWN0TG9ja2luZykge1xuICAgICAgaGVhZGVyc1sneC1hbXotYnVja2V0LW9iamVjdC1sb2NrLWVuYWJsZWQnXSA9IHRydWVcbiAgICB9XG5cbiAgICAvLyBGb3IgY3VzdG9tIHJlZ2lvbiBjbGllbnRzICBkZWZhdWx0IHRvIGN1c3RvbSByZWdpb24gc3BlY2lmaWVkIGluIGNsaWVudCBjb25zdHJ1Y3RvclxuICAgIGNvbnN0IGZpbmFsUmVnaW9uID0gdGhpcy5yZWdpb24gfHwgcmVnaW9uIHx8IERFRkFVTFRfUkVHSU9OXG5cbiAgICBjb25zdCByZXF1ZXN0T3B0OiBSZXF1ZXN0T3B0aW9uID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIGhlYWRlcnMgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQocmVxdWVzdE9wdCwgcGF5bG9hZCwgWzIwMF0sIGZpbmFsUmVnaW9uKVxuICAgIH0gY2F0Y2ggKGVycjogdW5rbm93bikge1xuICAgICAgaWYgKHJlZ2lvbiA9PT0gJycgfHwgcmVnaW9uID09PSBERUZBVUxUX1JFR0lPTikge1xuICAgICAgICBpZiAoZXJyIGluc3RhbmNlb2YgZXJyb3JzLlMzRXJyb3IpIHtcbiAgICAgICAgICBjb25zdCBlcnJDb2RlID0gZXJyLmNvZGVcbiAgICAgICAgICBjb25zdCBlcnJSZWdpb24gPSBlcnIucmVnaW9uXG4gICAgICAgICAgaWYgKGVyckNvZGUgPT09ICdBdXRob3JpemF0aW9uSGVhZGVyTWFsZm9ybWVkJyAmJiBlcnJSZWdpb24gIT09ICcnKSB7XG4gICAgICAgICAgICAvLyBSZXRyeSB3aXRoIHJlZ2lvbiByZXR1cm5lZCBhcyBwYXJ0IG9mIGVycm9yXG4gICAgICAgICAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHJlcXVlc3RPcHQsIHBheWxvYWQsIFsyMDBdLCBlcnJDb2RlKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRvIGNoZWNrIGlmIGEgYnVja2V0IGFscmVhZHkgZXhpc3RzLlxuICAgKi9cbiAgYXN5bmMgYnVja2V0RXhpc3RzKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdIRUFEJ1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lIH0pXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAvLyBAdHMtaWdub3JlXG4gICAgICBpZiAoZXJyLmNvZGUgPT09ICdOb1N1Y2hCdWNrZXQnIHx8IGVyci5jb2RlID09PSAnTm90Rm91bmQnKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldChidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+XG5cbiAgLyoqXG4gICAqIEBkZXByZWNhdGVkIHVzZSBwcm9taXNlIHN0eWxlIEFQSVxuICAgKi9cbiAgcmVtb3ZlQnVja2V0KGJ1Y2tldE5hbWU6IHN0cmluZywgY2FsbGJhY2s6IE5vUmVzdWx0Q2FsbGJhY2spOiB2b2lkXG5cbiAgYXN5bmMgcmVtb3ZlQnVja2V0KGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSB9LCAnJywgWzIwNF0pXG4gICAgZGVsZXRlIHRoaXMucmVnaW9uTWFwW2J1Y2tldE5hbWVdXG4gIH1cblxuICAvKipcbiAgICogQ2FsbGJhY2sgaXMgY2FsbGVkIHdpdGggcmVhZGFibGUgc3RyZWFtIG9mIHRoZSBvYmplY3QgY29udGVudC5cbiAgICovXG4gIGFzeW5jIGdldE9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgZ2V0T3B0cz86IEdldE9iamVjdE9wdHMpOiBQcm9taXNlPHN0cmVhbS5SZWFkYWJsZT4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIHJldHVybiB0aGlzLmdldFBhcnRpYWxPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgMCwgMCwgZ2V0T3B0cylcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsYmFjayBpcyBjYWxsZWQgd2l0aCByZWFkYWJsZSBzdHJlYW0gb2YgdGhlIHBhcnRpYWwgb2JqZWN0IGNvbnRlbnQuXG4gICAqIEBwYXJhbSBidWNrZXROYW1lXG4gICAqIEBwYXJhbSBvYmplY3ROYW1lXG4gICAqIEBwYXJhbSBvZmZzZXRcbiAgICogQHBhcmFtIGxlbmd0aCAtIGxlbmd0aCBvZiB0aGUgb2JqZWN0IHRoYXQgd2lsbCBiZSByZWFkIGluIHRoZSBzdHJlYW0gKG9wdGlvbmFsLCBpZiBub3Qgc3BlY2lmaWVkIHdlIHJlYWQgdGhlIHJlc3Qgb2YgdGhlIGZpbGUgZnJvbSB0aGUgb2Zmc2V0KVxuICAgKiBAcGFyYW0gZ2V0T3B0c1xuICAgKi9cbiAgYXN5bmMgZ2V0UGFydGlhbE9iamVjdChcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIG9mZnNldDogbnVtYmVyLFxuICAgIGxlbmd0aCA9IDAsXG4gICAgZ2V0T3B0cz86IEdldE9iamVjdE9wdHMsXG4gICk6IFByb21pc2U8c3RyZWFtLlJlYWRhYmxlPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc051bWJlcihvZmZzZXQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvZmZzZXQgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuICAgIGlmICghaXNOdW1iZXIobGVuZ3RoKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbGVuZ3RoIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cblxuICAgIGxldCByYW5nZSA9ICcnXG4gICAgaWYgKG9mZnNldCB8fCBsZW5ndGgpIHtcbiAgICAgIGlmIChvZmZzZXQpIHtcbiAgICAgICAgcmFuZ2UgPSBgYnl0ZXM9JHsrb2Zmc2V0fS1gXG4gICAgICB9IGVsc2Uge1xuICAgICAgICByYW5nZSA9ICdieXRlcz0wLSdcbiAgICAgICAgb2Zmc2V0ID0gMFxuICAgICAgfVxuICAgICAgaWYgKGxlbmd0aCkge1xuICAgICAgICByYW5nZSArPSBgJHsrbGVuZ3RoICsgb2Zmc2V0IC0gMX1gXG4gICAgICB9XG4gICAgfVxuXG4gICAgbGV0IHF1ZXJ5ID0gJydcbiAgICBsZXQgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7XG4gICAgICAuLi4ocmFuZ2UgIT09ICcnICYmIHsgcmFuZ2UgfSksXG4gICAgfVxuXG4gICAgaWYgKGdldE9wdHMpIHtcbiAgICAgIGNvbnN0IHNzZUhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICAgIC4uLihnZXRPcHRzLlNTRUN1c3RvbWVyQWxnb3JpdGhtICYmIHtcbiAgICAgICAgICAnWC1BbXotU2VydmVyLVNpZGUtRW5jcnlwdGlvbi1DdXN0b21lci1BbGdvcml0aG0nOiBnZXRPcHRzLlNTRUN1c3RvbWVyQWxnb3JpdGhtLFxuICAgICAgICB9KSxcbiAgICAgICAgLi4uKGdldE9wdHMuU1NFQ3VzdG9tZXJLZXkgJiYgeyAnWC1BbXotU2VydmVyLVNpZGUtRW5jcnlwdGlvbi1DdXN0b21lci1LZXknOiBnZXRPcHRzLlNTRUN1c3RvbWVyS2V5IH0pLFxuICAgICAgICAuLi4oZ2V0T3B0cy5TU0VDdXN0b21lcktleU1ENSAmJiB7XG4gICAgICAgICAgJ1gtQW16LVNlcnZlci1TaWRlLUVuY3J5cHRpb24tQ3VzdG9tZXItS2V5LU1ENSc6IGdldE9wdHMuU1NFQ3VzdG9tZXJLZXlNRDUsXG4gICAgICAgIH0pLFxuICAgICAgfVxuICAgICAgcXVlcnkgPSBxcy5zdHJpbmdpZnkoZ2V0T3B0cylcbiAgICAgIGhlYWRlcnMgPSB7XG4gICAgICAgIC4uLnByZXBlbmRYQU1aTWV0YShzc2VIZWFkZXJzKSxcbiAgICAgICAgLi4uaGVhZGVycyxcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBleHBlY3RlZFN0YXR1c0NvZGVzID0gWzIwMF1cbiAgICBpZiAocmFuZ2UpIHtcbiAgICAgIGV4cGVjdGVkU3RhdHVzQ29kZXMucHVzaCgyMDYpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzLCBxdWVyeSB9LCAnJywgZXhwZWN0ZWRTdGF0dXNDb2RlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBkb3dubG9hZCBvYmplY3QgY29udGVudCB0byBhIGZpbGUuXG4gICAqIFRoaXMgbWV0aG9kIHdpbGwgY3JlYXRlIGEgdGVtcCBmaWxlIG5hbWVkIGAke2ZpbGVuYW1lfS4ke2Jhc2U2NChldGFnKX0ucGFydC5taW5pb2Agd2hlbiBkb3dubG9hZGluZy5cbiAgICpcbiAgICogQHBhcmFtIGJ1Y2tldE5hbWUgLSBuYW1lIG9mIHRoZSBidWNrZXRcbiAgICogQHBhcmFtIG9iamVjdE5hbWUgLSBuYW1lIG9mIHRoZSBvYmplY3RcbiAgICogQHBhcmFtIGZpbGVQYXRoIC0gcGF0aCB0byB3aGljaCB0aGUgb2JqZWN0IGRhdGEgd2lsbCBiZSB3cml0dGVuIHRvXG4gICAqIEBwYXJhbSBnZXRPcHRzIC0gT3B0aW9uYWwgb2JqZWN0IGdldCBvcHRpb25cbiAgICovXG4gIGFzeW5jIGZHZXRPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcsIGdldE9wdHM/OiBHZXRPYmplY3RPcHRzKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gSW5wdXQgdmFsaWRhdGlvbi5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKGZpbGVQYXRoKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZmlsZVBhdGggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuXG4gICAgY29uc3QgZG93bmxvYWRUb1RtcEZpbGUgPSBhc3luYyAoKTogUHJvbWlzZTxzdHJpbmc+ID0+IHtcbiAgICAgIGxldCBwYXJ0RmlsZVN0cmVhbTogc3RyZWFtLldyaXRhYmxlXG4gICAgICBjb25zdCBvYmpTdGF0ID0gYXdhaXQgdGhpcy5zdGF0T2JqZWN0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGdldE9wdHMpXG4gICAgICBjb25zdCBlbmNvZGVkRXRhZyA9IEJ1ZmZlci5mcm9tKG9ialN0YXQuZXRhZykudG9TdHJpbmcoJ2Jhc2U2NCcpXG4gICAgICBjb25zdCBwYXJ0RmlsZSA9IGAke2ZpbGVQYXRofS4ke2VuY29kZWRFdGFnfS5wYXJ0Lm1pbmlvYFxuXG4gICAgICBhd2FpdCBmc3AubWtkaXIocGF0aC5kaXJuYW1lKGZpbGVQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSlcblxuICAgICAgbGV0IG9mZnNldCA9IDBcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnNwLnN0YXQocGFydEZpbGUpXG4gICAgICAgIGlmIChvYmpTdGF0LnNpemUgPT09IHN0YXRzLnNpemUpIHtcbiAgICAgICAgICByZXR1cm4gcGFydEZpbGVcbiAgICAgICAgfVxuICAgICAgICBvZmZzZXQgPSBzdGF0cy5zaXplXG4gICAgICAgIHBhcnRGaWxlU3RyZWFtID0gZnMuY3JlYXRlV3JpdGVTdHJlYW0ocGFydEZpbGUsIHsgZmxhZ3M6ICdhJyB9KVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBpZiAoZSBpbnN0YW5jZW9mIEVycm9yICYmIChlIGFzIHVua25vd24gYXMgeyBjb2RlOiBzdHJpbmcgfSkuY29kZSA9PT0gJ0VOT0VOVCcpIHtcbiAgICAgICAgICAvLyBmaWxlIG5vdCBleGlzdFxuICAgICAgICAgIHBhcnRGaWxlU3RyZWFtID0gZnMuY3JlYXRlV3JpdGVTdHJlYW0ocGFydEZpbGUsIHsgZmxhZ3M6ICd3JyB9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIG90aGVyIGVycm9yLCBtYXliZSBhY2Nlc3MgZGVueVxuICAgICAgICAgIHRocm93IGVcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBkb3dubG9hZFN0cmVhbSA9IGF3YWl0IHRoaXMuZ2V0UGFydGlhbE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBvZmZzZXQsIDAsIGdldE9wdHMpXG5cbiAgICAgIGF3YWl0IHN0cmVhbVByb21pc2UucGlwZWxpbmUoZG93bmxvYWRTdHJlYW0sIHBhcnRGaWxlU3RyZWFtKVxuICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmc3Auc3RhdChwYXJ0RmlsZSlcbiAgICAgIGlmIChzdGF0cy5zaXplID09PSBvYmpTdGF0LnNpemUpIHtcbiAgICAgICAgcmV0dXJuIHBhcnRGaWxlXG4gICAgICB9XG5cbiAgICAgIHRocm93IG5ldyBFcnJvcignU2l6ZSBtaXNtYXRjaCBiZXR3ZWVuIGRvd25sb2FkZWQgZmlsZSBhbmQgdGhlIG9iamVjdCcpXG4gICAgfVxuXG4gICAgY29uc3QgcGFydEZpbGUgPSBhd2FpdCBkb3dubG9hZFRvVG1wRmlsZSgpXG4gICAgYXdhaXQgZnNwLnJlbmFtZShwYXJ0RmlsZSwgZmlsZVBhdGgpXG4gIH1cblxuICAvKipcbiAgICogU3RhdCBpbmZvcm1hdGlvbiBvZiB0aGUgb2JqZWN0LlxuICAgKi9cbiAgYXN5bmMgc3RhdE9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgc3RhdE9wdHM/OiBTdGF0T2JqZWN0T3B0cyk6IFByb21pc2U8QnVja2V0SXRlbVN0YXQ+IHtcbiAgICBjb25zdCBzdGF0T3B0RGVmID0gc3RhdE9wdHMgfHwge31cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGlmICghaXNPYmplY3Qoc3RhdE9wdERlZikpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3N0YXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5ID0gcXMuc3RyaW5naWZ5KHN0YXRPcHREZWYpXG4gICAgY29uc3QgbWV0aG9kID0gJ0hFQUQnXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSlcblxuICAgIHJldHVybiB7XG4gICAgICBzaXplOiBwYXJzZUludChyZXMuaGVhZGVyc1snY29udGVudC1sZW5ndGgnXSBhcyBzdHJpbmcpLFxuICAgICAgbWV0YURhdGE6IGV4dHJhY3RNZXRhZGF0YShyZXMuaGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXG4gICAgICBsYXN0TW9kaWZpZWQ6IG5ldyBEYXRlKHJlcy5oZWFkZXJzWydsYXN0LW1vZGlmaWVkJ10gYXMgc3RyaW5nKSxcbiAgICAgIHZlcnNpb25JZDogZ2V0VmVyc2lvbklkKHJlcy5oZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcbiAgICAgIGV0YWc6IHNhbml0aXplRVRhZyhyZXMuaGVhZGVycy5ldGFnKSxcbiAgICB9XG4gIH1cblxuICBhc3luYyByZW1vdmVPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHJlbW92ZU9wdHM/OiBSZW1vdmVPcHRpb25zKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAocmVtb3ZlT3B0cyAmJiAhaXNPYmplY3QocmVtb3ZlT3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3JlbW92ZU9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcblxuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cbiAgICBpZiAocmVtb3ZlT3B0cz8uZ292ZXJuYW5jZUJ5cGFzcykge1xuICAgICAgaGVhZGVyc1snWC1BbXotQnlwYXNzLUdvdmVybmFuY2UtUmV0ZW50aW9uJ10gPSB0cnVlXG4gICAgfVxuICAgIGlmIChyZW1vdmVPcHRzPy5mb3JjZURlbGV0ZSkge1xuICAgICAgaGVhZGVyc1sneC1taW5pby1mb3JjZS1kZWxldGUnXSA9IHRydWVcbiAgICB9XG5cbiAgICBjb25zdCBxdWVyeVBhcmFtczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XG4gICAgaWYgKHJlbW92ZU9wdHM/LnZlcnNpb25JZCkge1xuICAgICAgcXVlcnlQYXJhbXMudmVyc2lvbklkID0gYCR7cmVtb3ZlT3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cbiAgICBjb25zdCBxdWVyeSA9IHFzLnN0cmluZ2lmeShxdWVyeVBhcmFtcylcblxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMsIHF1ZXJ5IH0sICcnLCBbMjAwLCAyMDRdKVxuICB9XG5cbiAgLy8gQ2FsbHMgaW1wbGVtZW50ZWQgYmVsb3cgYXJlIHJlbGF0ZWQgdG8gbXVsdGlwYXJ0LlxuXG4gIGxpc3RJbmNvbXBsZXRlVXBsb2FkcyhcbiAgICBidWNrZXQ6IHN0cmluZyxcbiAgICBwcmVmaXg6IHN0cmluZyxcbiAgICByZWN1cnNpdmU6IGJvb2xlYW4sXG4gICk6IEJ1Y2tldFN0cmVhbTxJbmNvbXBsZXRlVXBsb2FkZWRCdWNrZXRJdGVtPiB7XG4gICAgaWYgKHByZWZpeCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBwcmVmaXggPSAnJ1xuICAgIH1cbiAgICBpZiAocmVjdXJzaXZlID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJlY3Vyc2l2ZSA9IGZhbHNlXG4gICAgfVxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0KVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRQcmVmaXgocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkUHJlZml4RXJyb3IoYEludmFsaWQgcHJlZml4IDogJHtwcmVmaXh9YClcbiAgICB9XG4gICAgaWYgKCFpc0Jvb2xlYW4ocmVjdXJzaXZlKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVjdXJzaXZlIHNob3VsZCBiZSBvZiB0eXBlIFwiYm9vbGVhblwiJylcbiAgICB9XG4gICAgY29uc3QgZGVsaW1pdGVyID0gcmVjdXJzaXZlID8gJycgOiAnLydcbiAgICBsZXQga2V5TWFya2VyID0gJydcbiAgICBsZXQgdXBsb2FkSWRNYXJrZXIgPSAnJ1xuICAgIGNvbnN0IHVwbG9hZHM6IHVua25vd25bXSA9IFtdXG4gICAgbGV0IGVuZGVkID0gZmFsc2VcblxuICAgIC8vIFRPRE86IHJlZmFjdG9yIHRoaXMgd2l0aCBhc3luYy9hd2FpdCBhbmQgYHN0cmVhbS5SZWFkYWJsZS5mcm9tYFxuICAgIGNvbnN0IHJlYWRTdHJlYW0gPSBuZXcgc3RyZWFtLlJlYWRhYmxlKHsgb2JqZWN0TW9kZTogdHJ1ZSB9KVxuICAgIHJlYWRTdHJlYW0uX3JlYWQgPSAoKSA9PiB7XG4gICAgICAvLyBwdXNoIG9uZSB1cGxvYWQgaW5mbyBwZXIgX3JlYWQoKVxuICAgICAgaWYgKHVwbG9hZHMubGVuZ3RoKSB7XG4gICAgICAgIHJldHVybiByZWFkU3RyZWFtLnB1c2godXBsb2Fkcy5zaGlmdCgpKVxuICAgICAgfVxuICAgICAgaWYgKGVuZGVkKSB7XG4gICAgICAgIHJldHVybiByZWFkU3RyZWFtLnB1c2gobnVsbClcbiAgICAgIH1cbiAgICAgIHRoaXMubGlzdEluY29tcGxldGVVcGxvYWRzUXVlcnkoYnVja2V0LCBwcmVmaXgsIGtleU1hcmtlciwgdXBsb2FkSWRNYXJrZXIsIGRlbGltaXRlcikudGhlbihcbiAgICAgICAgKHJlc3VsdCkgPT4ge1xuICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgcmVzdWx0LnByZWZpeGVzLmZvckVhY2goKHByZWZpeCkgPT4gdXBsb2Fkcy5wdXNoKHByZWZpeCkpXG4gICAgICAgICAgYXN5bmMuZWFjaFNlcmllcyhcbiAgICAgICAgICAgIHJlc3VsdC51cGxvYWRzLFxuICAgICAgICAgICAgKHVwbG9hZCwgY2IpID0+IHtcbiAgICAgICAgICAgICAgLy8gZm9yIGVhY2ggaW5jb21wbGV0ZSB1cGxvYWQgYWRkIHRoZSBzaXplcyBvZiBpdHMgdXBsb2FkZWQgcGFydHNcbiAgICAgICAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICAgIHRoaXMubGlzdFBhcnRzKGJ1Y2tldCwgdXBsb2FkLmtleSwgdXBsb2FkLnVwbG9hZElkKS50aGVuKFxuICAgICAgICAgICAgICAgIChwYXJ0czogUGFydFtdKSA9PiB7XG4gICAgICAgICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAgICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICAgICAgICB1cGxvYWQuc2l6ZSA9IHBhcnRzLnJlZHVjZSgoYWNjLCBpdGVtKSA9PiBhY2MgKyBpdGVtLnNpemUsIDApXG4gICAgICAgICAgICAgICAgICB1cGxvYWRzLnB1c2godXBsb2FkKVxuICAgICAgICAgICAgICAgICAgY2IoKVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgKGVycjogRXJyb3IpID0+IGNiKGVyciksXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAoZXJyKSA9PiB7XG4gICAgICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgICAgICByZWFkU3RyZWFtLmVtaXQoJ2Vycm9yJywgZXJyKVxuICAgICAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGlmIChyZXN1bHQuaXNUcnVuY2F0ZWQpIHtcbiAgICAgICAgICAgICAgICBrZXlNYXJrZXIgPSByZXN1bHQubmV4dEtleU1hcmtlclxuICAgICAgICAgICAgICAgIHVwbG9hZElkTWFya2VyID0gcmVzdWx0Lm5leHRVcGxvYWRJZE1hcmtlclxuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGVuZGVkID0gdHJ1ZVxuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICAgIHJlYWRTdHJlYW0uX3JlYWQoKVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICApXG4gICAgICAgIH0sXG4gICAgICAgIChlKSA9PiB7XG4gICAgICAgICAgcmVhZFN0cmVhbS5lbWl0KCdlcnJvcicsIGUpXG4gICAgICAgIH0sXG4gICAgICApXG4gICAgfVxuICAgIHJldHVybiByZWFkU3RyZWFtXG4gIH1cblxuICAvKipcbiAgICogQ2FsbGVkIGJ5IGxpc3RJbmNvbXBsZXRlVXBsb2FkcyB0byBmZXRjaCBhIGJhdGNoIG9mIGluY29tcGxldGUgdXBsb2Fkcy5cbiAgICovXG4gIGFzeW5jIGxpc3RJbmNvbXBsZXRlVXBsb2Fkc1F1ZXJ5KFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBwcmVmaXg6IHN0cmluZyxcbiAgICBrZXlNYXJrZXI6IHN0cmluZyxcbiAgICB1cGxvYWRJZE1hcmtlcjogc3RyaW5nLFxuICAgIGRlbGltaXRlcjogc3RyaW5nLFxuICApOiBQcm9taXNlPExpc3RNdWx0aXBhcnRSZXN1bHQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ByZWZpeCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhrZXlNYXJrZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdrZXlNYXJrZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcodXBsb2FkSWRNYXJrZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd1cGxvYWRJZE1hcmtlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhkZWxpbWl0ZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdkZWxpbWl0ZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGNvbnN0IHF1ZXJpZXMgPSBbXVxuICAgIHF1ZXJpZXMucHVzaChgcHJlZml4PSR7dXJpRXNjYXBlKHByZWZpeCl9YClcbiAgICBxdWVyaWVzLnB1c2goYGRlbGltaXRlcj0ke3VyaUVzY2FwZShkZWxpbWl0ZXIpfWApXG5cbiAgICBpZiAoa2V5TWFya2VyKSB7XG4gICAgICBxdWVyaWVzLnB1c2goYGtleS1tYXJrZXI9JHt1cmlFc2NhcGUoa2V5TWFya2VyKX1gKVxuICAgIH1cbiAgICBpZiAodXBsb2FkSWRNYXJrZXIpIHtcbiAgICAgIHF1ZXJpZXMucHVzaChgdXBsb2FkLWlkLW1hcmtlcj0ke3VwbG9hZElkTWFya2VyfWApXG4gICAgfVxuXG4gICAgY29uc3QgbWF4VXBsb2FkcyA9IDEwMDBcbiAgICBxdWVyaWVzLnB1c2goYG1heC11cGxvYWRzPSR7bWF4VXBsb2Fkc31gKVxuICAgIHF1ZXJpZXMuc29ydCgpXG4gICAgcXVlcmllcy51bnNoaWZ0KCd1cGxvYWRzJylcbiAgICBsZXQgcXVlcnkgPSAnJ1xuICAgIGlmIChxdWVyaWVzLmxlbmd0aCA+IDApIHtcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcmllcy5qb2luKCcmJyl9YFxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZUxpc3RNdWx0aXBhcnQoYm9keSlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbml0aWF0ZSBhIG5ldyBtdWx0aXBhcnQgdXBsb2FkLlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIGFzeW5jIGluaXRpYXRlTmV3TXVsdGlwYXJ0VXBsb2FkKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChoZWFkZXJzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKCdjb250ZW50VHlwZSBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ1BPU1QnXG4gICAgY29uc3QgcXVlcnkgPSAndXBsb2FkcydcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0pXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc0J1ZmZlcihyZXMpXG4gICAgcmV0dXJuIHBhcnNlSW5pdGlhdGVNdWx0aXBhcnQoYm9keS50b1N0cmluZygpKVxuICB9XG5cbiAgLyoqXG4gICAqIEludGVybmFsIE1ldGhvZCB0byBhYm9ydCBhIG11bHRpcGFydCB1cGxvYWQgcmVxdWVzdCBpbiBjYXNlIG9mIGFueSBlcnJvcnMuXG4gICAqXG4gICAqIEBwYXJhbSBidWNrZXROYW1lIC0gQnVja2V0IE5hbWVcbiAgICogQHBhcmFtIG9iamVjdE5hbWUgLSBPYmplY3QgTmFtZVxuICAgKiBAcGFyYW0gdXBsb2FkSWQgLSBpZCBvZiBhIG11bHRpcGFydCB1cGxvYWQgdG8gY2FuY2VsIGR1cmluZyBjb21wb3NlIG9iamVjdCBzZXF1ZW5jZS5cbiAgICovXG4gIGFzeW5jIGFib3J0TXVsdGlwYXJ0VXBsb2FkKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCB1cGxvYWRJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBjb25zdCBxdWVyeSA9IGB1cGxvYWRJZD0ke3VwbG9hZElkfWBcblxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWU6IG9iamVjdE5hbWUsIHF1ZXJ5IH1cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHJlcXVlc3RPcHRpb25zLCAnJywgWzIwNF0pXG4gIH1cblxuICBhc3luYyBmaW5kVXBsb2FkSWQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgbGV0IGxhdGVzdFVwbG9hZDogTGlzdE11bHRpcGFydFJlc3VsdFsndXBsb2FkcyddW251bWJlcl0gfCB1bmRlZmluZWRcbiAgICBsZXQga2V5TWFya2VyID0gJydcbiAgICBsZXQgdXBsb2FkSWRNYXJrZXIgPSAnJ1xuICAgIGZvciAoOzspIHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMubGlzdEluY29tcGxldGVVcGxvYWRzUXVlcnkoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwga2V5TWFya2VyLCB1cGxvYWRJZE1hcmtlciwgJycpXG4gICAgICBmb3IgKGNvbnN0IHVwbG9hZCBvZiByZXN1bHQudXBsb2Fkcykge1xuICAgICAgICBpZiAodXBsb2FkLmtleSA9PT0gb2JqZWN0TmFtZSkge1xuICAgICAgICAgIGlmICghbGF0ZXN0VXBsb2FkIHx8IHVwbG9hZC5pbml0aWF0ZWQuZ2V0VGltZSgpID4gbGF0ZXN0VXBsb2FkLmluaXRpYXRlZC5nZXRUaW1lKCkpIHtcbiAgICAgICAgICAgIGxhdGVzdFVwbG9hZCA9IHVwbG9hZFxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKHJlc3VsdC5pc1RydW5jYXRlZCkge1xuICAgICAgICBrZXlNYXJrZXIgPSByZXN1bHQubmV4dEtleU1hcmtlclxuICAgICAgICB1cGxvYWRJZE1hcmtlciA9IHJlc3VsdC5uZXh0VXBsb2FkSWRNYXJrZXJcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgYnJlYWtcbiAgICB9XG4gICAgcmV0dXJuIGxhdGVzdFVwbG9hZD8udXBsb2FkSWRcbiAgfVxuXG4gIC8qKlxuICAgKiB0aGlzIGNhbGwgd2lsbCBhZ2dyZWdhdGUgdGhlIHBhcnRzIG9uIHRoZSBzZXJ2ZXIgaW50byBhIHNpbmdsZSBvYmplY3QuXG4gICAqL1xuICBhc3luYyBjb21wbGV0ZU11bHRpcGFydFVwbG9hZChcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIHVwbG9hZElkOiBzdHJpbmcsXG4gICAgZXRhZ3M6IHtcbiAgICAgIHBhcnQ6IG51bWJlclxuICAgICAgZXRhZz86IHN0cmluZ1xuICAgIH1bXSxcbiAgKTogUHJvbWlzZTx7IGV0YWc6IHN0cmluZzsgdmVyc2lvbklkOiBzdHJpbmcgfCBudWxsIH0+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHVwbG9hZElkKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndXBsb2FkSWQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QoZXRhZ3MpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdldGFncyBzaG91bGQgYmUgb2YgdHlwZSBcIkFycmF5XCInKVxuICAgIH1cblxuICAgIGlmICghdXBsb2FkSWQpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3VwbG9hZElkIGNhbm5vdCBiZSBlbXB0eScpXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BPU1QnXG4gICAgY29uc3QgcXVlcnkgPSBgdXBsb2FkSWQ9JHt1cmlFc2NhcGUodXBsb2FkSWQpfWBcblxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoKVxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KHtcbiAgICAgIENvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkOiB7XG4gICAgICAgICQ6IHtcbiAgICAgICAgICB4bWxuczogJ2h0dHA6Ly9zMy5hbWF6b25hd3MuY29tL2RvYy8yMDA2LTAzLTAxLycsXG4gICAgICAgIH0sXG4gICAgICAgIFBhcnQ6IGV0YWdzLm1hcCgoZXRhZykgPT4ge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBQYXJ0TnVtYmVyOiBldGFnLnBhcnQsXG4gICAgICAgICAgICBFVGFnOiBldGFnLmV0YWcsXG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgIH0sXG4gICAgfSlcblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSwgcGF5bG9hZClcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzQnVmZmVyKHJlcylcbiAgICBjb25zdCByZXN1bHQgPSBwYXJzZUNvbXBsZXRlTXVsdGlwYXJ0KGJvZHkudG9TdHJpbmcoKSlcbiAgICBpZiAoIXJlc3VsdCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdCVUc6IGZhaWxlZCB0byBwYXJzZSBzZXJ2ZXIgcmVzcG9uc2UnKVxuICAgIH1cblxuICAgIGlmIChyZXN1bHQuZXJyQ29kZSkge1xuICAgICAgLy8gTXVsdGlwYXJ0IENvbXBsZXRlIEFQSSByZXR1cm5zIGFuIGVycm9yIFhNTCBhZnRlciBhIDIwMCBodHRwIHN0YXR1c1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5TM0Vycm9yKHJlc3VsdC5lcnJNZXNzYWdlKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAvLyBAdHMtaWdub3JlXG4gICAgICBldGFnOiByZXN1bHQuZXRhZyBhcyBzdHJpbmcsXG4gICAgICB2ZXJzaW9uSWQ6IGdldFZlcnNpb25JZChyZXMuaGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdldCBwYXJ0LWluZm8gb2YgYWxsIHBhcnRzIG9mIGFuIGluY29tcGxldGUgdXBsb2FkIHNwZWNpZmllZCBieSB1cGxvYWRJZC5cbiAgICovXG4gIHByb3RlY3RlZCBhc3luYyBsaXN0UGFydHMoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHVwbG9hZElkOiBzdHJpbmcpOiBQcm9taXNlPFVwbG9hZGVkUGFydFtdPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyh1cGxvYWRJZCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3VwbG9hZElkIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIXVwbG9hZElkKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd1cGxvYWRJZCBjYW5ub3QgYmUgZW1wdHknKVxuICAgIH1cblxuICAgIGNvbnN0IHBhcnRzOiBVcGxvYWRlZFBhcnRbXSA9IFtdXG4gICAgbGV0IG1hcmtlciA9IDBcbiAgICBsZXQgcmVzdWx0XG4gICAgZG8ge1xuICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5saXN0UGFydHNRdWVyeShidWNrZXROYW1lLCBvYmplY3ROYW1lLCB1cGxvYWRJZCwgbWFya2VyKVxuICAgICAgbWFya2VyID0gcmVzdWx0Lm1hcmtlclxuICAgICAgcGFydHMucHVzaCguLi5yZXN1bHQucGFydHMpXG4gICAgfSB3aGlsZSAocmVzdWx0LmlzVHJ1bmNhdGVkKVxuXG4gICAgcmV0dXJuIHBhcnRzXG4gIH1cblxuICAvKipcbiAgICogQ2FsbGVkIGJ5IGxpc3RQYXJ0cyB0byBmZXRjaCBhIGJhdGNoIG9mIHBhcnQtaW5mb1xuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBsaXN0UGFydHNRdWVyeShidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgdXBsb2FkSWQ6IHN0cmluZywgbWFya2VyOiBudW1iZXIpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHVwbG9hZElkKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndXBsb2FkSWQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNOdW1iZXIobWFya2VyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbWFya2VyIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cbiAgICBpZiAoIXVwbG9hZElkKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd1cGxvYWRJZCBjYW5ub3QgYmUgZW1wdHknKVxuICAgIH1cblxuICAgIGxldCBxdWVyeSA9IGB1cGxvYWRJZD0ke3VyaUVzY2FwZSh1cGxvYWRJZCl9YFxuICAgIGlmIChtYXJrZXIpIHtcbiAgICAgIHF1ZXJ5ICs9IGAmcGFydC1udW1iZXItbWFya2VyPSR7bWFya2VyfWBcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSlcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZUxpc3RQYXJ0cyhhd2FpdCByZWFkQXNTdHJpbmcocmVzKSlcbiAgfVxuXG4gIGFzeW5jIGxpc3RCdWNrZXRzKCk6IFByb21pc2U8QnVja2V0SXRlbUZyb21MaXN0W10+IHtcbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHJlZ2lvbkNvbmYgPSB0aGlzLnJlZ2lvbiB8fCBERUZBVUxUX1JFR0lPTlxuICAgIGNvbnN0IGh0dHBSZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QgfSwgJycsIFsyMDBdLCByZWdpb25Db25mKVxuICAgIGNvbnN0IHhtbFJlc3VsdCA9IGF3YWl0IHJlYWRBc1N0cmluZyhodHRwUmVzKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlTGlzdEJ1Y2tldCh4bWxSZXN1bHQpXG4gIH1cblxuICAvKipcbiAgICogQ2FsY3VsYXRlIHBhcnQgc2l6ZSBnaXZlbiB0aGUgb2JqZWN0IHNpemUuIFBhcnQgc2l6ZSB3aWxsIGJlIGF0bGVhc3QgdGhpcy5wYXJ0U2l6ZVxuICAgKi9cbiAgY2FsY3VsYXRlUGFydFNpemUoc2l6ZTogbnVtYmVyKSB7XG4gICAgaWYgKCFpc051bWJlcihzaXplKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc2l6ZSBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICB9XG4gICAgaWYgKHNpemUgPiB0aGlzLm1heE9iamVjdFNpemUpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYHNpemUgc2hvdWxkIG5vdCBiZSBtb3JlIHRoYW4gJHt0aGlzLm1heE9iamVjdFNpemV9YClcbiAgICB9XG4gICAgaWYgKHRoaXMub3ZlclJpZGVQYXJ0U2l6ZSkge1xuICAgICAgcmV0dXJuIHRoaXMucGFydFNpemVcbiAgICB9XG4gICAgbGV0IHBhcnRTaXplID0gdGhpcy5wYXJ0U2l6ZVxuICAgIGZvciAoOzspIHtcbiAgICAgIC8vIHdoaWxlKHRydWUpIHsuLi59IHRocm93cyBsaW50aW5nIGVycm9yLlxuICAgICAgLy8gSWYgcGFydFNpemUgaXMgYmlnIGVub3VnaCB0byBhY2NvbW9kYXRlIHRoZSBvYmplY3Qgc2l6ZSwgdGhlbiB1c2UgaXQuXG4gICAgICBpZiAocGFydFNpemUgKiAxMDAwMCA+IHNpemUpIHtcbiAgICAgICAgcmV0dXJuIHBhcnRTaXplXG4gICAgICB9XG4gICAgICAvLyBUcnkgcGFydCBzaXplcyBhcyA2NE1CLCA4ME1CLCA5Nk1CIGV0Yy5cbiAgICAgIHBhcnRTaXplICs9IDE2ICogMTAyNCAqIDEwMjRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVXBsb2FkcyB0aGUgb2JqZWN0IHVzaW5nIGNvbnRlbnRzIGZyb20gYSBmaWxlXG4gICAqL1xuICBhc3luYyBmUHV0T2JqZWN0KGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nLCBtZXRhRGF0YT86IE9iamVjdE1ldGFEYXRhKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoIWlzU3RyaW5nKGZpbGVQYXRoKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZmlsZVBhdGggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmIChtZXRhRGF0YSAmJiAhaXNPYmplY3QobWV0YURhdGEpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtZXRhRGF0YSBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICAvLyBJbnNlcnRzIGNvcnJlY3QgYGNvbnRlbnQtdHlwZWAgYXR0cmlidXRlIGJhc2VkIG9uIG1ldGFEYXRhIGFuZCBmaWxlUGF0aFxuICAgIG1ldGFEYXRhID0gaW5zZXJ0Q29udGVudFR5cGUobWV0YURhdGEgfHwge30sIGZpbGVQYXRoKVxuICAgIGNvbnN0IHN0YXQgPSBhd2FpdCBmc3AubHN0YXQoZmlsZVBhdGgpXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucHV0T2JqZWN0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGZzLmNyZWF0ZVJlYWRTdHJlYW0oZmlsZVBhdGgpLCBzdGF0LnNpemUsIG1ldGFEYXRhKVxuICB9XG5cbiAgLyoqXG4gICAqICBVcGxvYWRpbmcgYSBzdHJlYW0sIFwiQnVmZmVyXCIgb3IgXCJzdHJpbmdcIi5cbiAgICogIEl0J3MgcmVjb21tZW5kZWQgdG8gcGFzcyBgc2l6ZWAgYXJndW1lbnQgd2l0aCBzdHJlYW0uXG4gICAqL1xuICBhc3luYyBwdXRPYmplY3QoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBzdHJlYW06IHN0cmVhbS5SZWFkYWJsZSB8IEJ1ZmZlciB8IHN0cmluZyxcbiAgICBzaXplPzogbnVtYmVyLFxuICAgIG1ldGFEYXRhPzogSXRlbUJ1Y2tldE1ldGFkYXRhLFxuICApOiBQcm9taXNlPFVwbG9hZGVkT2JqZWN0SW5mbz4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgLy8gV2UnbGwgbmVlZCB0byBzaGlmdCBhcmd1bWVudHMgdG8gdGhlIGxlZnQgYmVjYXVzZSBvZiBtZXRhRGF0YVxuICAgIC8vIGFuZCBzaXplIGJlaW5nIG9wdGlvbmFsLlxuICAgIGlmIChpc09iamVjdChzaXplKSkge1xuICAgICAgbWV0YURhdGEgPSBzaXplXG4gICAgfVxuICAgIC8vIEVuc3VyZXMgTWV0YWRhdGEgaGFzIGFwcHJvcHJpYXRlIHByZWZpeCBmb3IgQTMgQVBJXG4gICAgY29uc3QgaGVhZGVycyA9IHByZXBlbmRYQU1aTWV0YShtZXRhRGF0YSlcbiAgICBpZiAodHlwZW9mIHN0cmVhbSA9PT0gJ3N0cmluZycgfHwgc3RyZWFtIGluc3RhbmNlb2YgQnVmZmVyKSB7XG4gICAgICAvLyBBZGFwdHMgdGhlIG5vbi1zdHJlYW0gaW50ZXJmYWNlIGludG8gYSBzdHJlYW0uXG4gICAgICBzaXplID0gc3RyZWFtLmxlbmd0aFxuICAgICAgc3RyZWFtID0gcmVhZGFibGVTdHJlYW0oc3RyZWFtKVxuICAgIH0gZWxzZSBpZiAoIWlzUmVhZGFibGVTdHJlYW0oc3RyZWFtKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndGhpcmQgYXJndW1lbnQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJlYW0uUmVhZGFibGVcIiBvciBcIkJ1ZmZlclwiIG9yIFwic3RyaW5nXCInKVxuICAgIH1cblxuICAgIGlmIChpc051bWJlcihzaXplKSAmJiBzaXplIDwgMCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgc2l6ZSBjYW5ub3QgYmUgbmVnYXRpdmUsIGdpdmVuIHNpemU6ICR7c2l6ZX1gKVxuICAgIH1cblxuICAgIC8vIEdldCB0aGUgcGFydCBzaXplIGFuZCBmb3J3YXJkIHRoYXQgdG8gdGhlIEJsb2NrU3RyZWFtLiBEZWZhdWx0IHRvIHRoZVxuICAgIC8vIGxhcmdlc3QgYmxvY2sgc2l6ZSBwb3NzaWJsZSBpZiBuZWNlc3NhcnkuXG4gICAgaWYgKCFpc051bWJlcihzaXplKSkge1xuICAgICAgc2l6ZSA9IHRoaXMubWF4T2JqZWN0U2l6ZVxuICAgIH1cblxuICAgIC8vIEdldCB0aGUgcGFydCBzaXplIGFuZCBmb3J3YXJkIHRoYXQgdG8gdGhlIEJsb2NrU3RyZWFtLiBEZWZhdWx0IHRvIHRoZVxuICAgIC8vIGxhcmdlc3QgYmxvY2sgc2l6ZSBwb3NzaWJsZSBpZiBuZWNlc3NhcnkuXG4gICAgaWYgKHNpemUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgY29uc3Qgc3RhdFNpemUgPSBhd2FpdCBnZXRDb250ZW50TGVuZ3RoKHN0cmVhbSlcbiAgICAgIGlmIChzdGF0U2l6ZSAhPT0gbnVsbCkge1xuICAgICAgICBzaXplID0gc3RhdFNpemVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWlzTnVtYmVyKHNpemUpKSB7XG4gICAgICAvLyBCYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgICBzaXplID0gdGhpcy5tYXhPYmplY3RTaXplXG4gICAgfVxuXG4gICAgY29uc3QgcGFydFNpemUgPSB0aGlzLmNhbGN1bGF0ZVBhcnRTaXplKHNpemUpXG4gICAgaWYgKHR5cGVvZiBzdHJlYW0gPT09ICdzdHJpbmcnIHx8IHN0cmVhbS5yZWFkYWJsZUxlbmd0aCA9PT0gMCB8fCBCdWZmZXIuaXNCdWZmZXIoc3RyZWFtKSB8fCBzaXplIDw9IHBhcnRTaXplKSB7XG4gICAgICBjb25zdCBidWYgPSBpc1JlYWRhYmxlU3RyZWFtKHN0cmVhbSkgPyBhd2FpdCByZWFkQXNCdWZmZXIoc3RyZWFtKSA6IEJ1ZmZlci5mcm9tKHN0cmVhbSlcbiAgICAgIHJldHVybiB0aGlzLnVwbG9hZEJ1ZmZlcihidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzLCBidWYpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMudXBsb2FkU3RyZWFtKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMsIHN0cmVhbSwgcGFydFNpemUpXG4gIH1cblxuICAvKipcbiAgICogbWV0aG9kIHRvIHVwbG9hZCBidWZmZXIgaW4gb25lIGNhbGxcbiAgICogQHByaXZhdGVcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgdXBsb2FkQnVmZmVyKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMsXG4gICAgYnVmOiBCdWZmZXIsXG4gICk6IFByb21pc2U8VXBsb2FkZWRPYmplY3RJbmZvPiB7XG4gICAgY29uc3QgeyBtZDVzdW0sIHNoYTI1NnN1bSB9ID0gaGFzaEJpbmFyeShidWYsIHRoaXMuZW5hYmxlU0hBMjU2KVxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTGVuZ3RoJ10gPSBidWYubGVuZ3RoXG4gICAgaWYgKCF0aGlzLmVuYWJsZVNIQTI1Nikge1xuICAgICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IG1kNXN1bVxuICAgIH1cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0U3RyZWFtQXN5bmMoXG4gICAgICB7XG4gICAgICAgIG1ldGhvZDogJ1BVVCcsXG4gICAgICAgIGJ1Y2tldE5hbWUsXG4gICAgICAgIG9iamVjdE5hbWUsXG4gICAgICAgIGhlYWRlcnMsXG4gICAgICB9LFxuICAgICAgYnVmLFxuICAgICAgc2hhMjU2c3VtLFxuICAgICAgWzIwMF0sXG4gICAgICAnJyxcbiAgICApXG4gICAgYXdhaXQgZHJhaW5SZXNwb25zZShyZXMpXG4gICAgcmV0dXJuIHtcbiAgICAgIGV0YWc6IHNhbml0aXplRVRhZyhyZXMuaGVhZGVycy5ldGFnKSxcbiAgICAgIHZlcnNpb25JZDogZ2V0VmVyc2lvbklkKHJlcy5oZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogdXBsb2FkIHN0cmVhbSB3aXRoIE11bHRpcGFydFVwbG9hZFxuICAgKiBAcHJpdmF0ZVxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyB1cGxvYWRTdHJlYW0oXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyxcbiAgICBib2R5OiBzdHJlYW0uUmVhZGFibGUsXG4gICAgcGFydFNpemU6IG51bWJlcixcbiAgKTogUHJvbWlzZTxVcGxvYWRlZE9iamVjdEluZm8+IHtcbiAgICAvLyBBIG1hcCBvZiB0aGUgcHJldmlvdXNseSB1cGxvYWRlZCBjaHVua3MsIGZvciByZXN1bWluZyBhIGZpbGUgdXBsb2FkLiBUaGlzXG4gICAgLy8gd2lsbCBiZSBudWxsIGlmIHdlIGFyZW4ndCByZXN1bWluZyBhbiB1cGxvYWQuXG4gICAgY29uc3Qgb2xkUGFydHM6IFJlY29yZDxudW1iZXIsIFBhcnQ+ID0ge31cblxuICAgIC8vIEtlZXAgdHJhY2sgb2YgdGhlIGV0YWdzIGZvciBhZ2dyZWdhdGluZyB0aGUgY2h1bmtzIHRvZ2V0aGVyIGxhdGVyLiBFYWNoXG4gICAgLy8gZXRhZyByZXByZXNlbnRzIGEgc2luZ2xlIGNodW5rIG9mIHRoZSBmaWxlLlxuICAgIGNvbnN0IGVUYWdzOiBQYXJ0W10gPSBbXVxuXG4gICAgY29uc3QgcHJldmlvdXNVcGxvYWRJZCA9IGF3YWl0IHRoaXMuZmluZFVwbG9hZElkKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUpXG4gICAgbGV0IHVwbG9hZElkOiBzdHJpbmdcbiAgICBpZiAoIXByZXZpb3VzVXBsb2FkSWQpIHtcbiAgICAgIHVwbG9hZElkID0gYXdhaXQgdGhpcy5pbml0aWF0ZU5ld011bHRpcGFydFVwbG9hZChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzKVxuICAgIH0gZWxzZSB7XG4gICAgICB1cGxvYWRJZCA9IHByZXZpb3VzVXBsb2FkSWRcbiAgICAgIGNvbnN0IG9sZFRhZ3MgPSBhd2FpdCB0aGlzLmxpc3RQYXJ0cyhidWNrZXROYW1lLCBvYmplY3ROYW1lLCBwcmV2aW91c1VwbG9hZElkKVxuICAgICAgb2xkVGFncy5mb3JFYWNoKChlKSA9PiB7XG4gICAgICAgIG9sZFBhcnRzW2UucGFydF0gPSBlXG4gICAgICB9KVxuICAgIH1cblxuICAgIGNvbnN0IGNodW5raWVyID0gbmV3IEJsb2NrU3RyZWFtMih7IHNpemU6IHBhcnRTaXplLCB6ZXJvUGFkZGluZzogZmFsc2UgfSlcblxuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tdW51c2VkLXZhcnNcbiAgICBjb25zdCBbXywgb10gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGJvZHkucGlwZShjaHVua2llcikub24oJ2Vycm9yJywgcmVqZWN0KVxuICAgICAgICBjaHVua2llci5vbignZW5kJywgcmVzb2x2ZSkub24oJ2Vycm9yJywgcmVqZWN0KVxuICAgICAgfSksXG4gICAgICAoYXN5bmMgKCkgPT4ge1xuICAgICAgICBsZXQgcGFydE51bWJlciA9IDFcblxuICAgICAgICBmb3IgYXdhaXQgKGNvbnN0IGNodW5rIG9mIGNodW5raWVyKSB7XG4gICAgICAgICAgY29uc3QgbWQ1ID0gY3J5cHRvLmNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShjaHVuaykuZGlnZXN0KClcblxuICAgICAgICAgIGNvbnN0IG9sZFBhcnQgPSBvbGRQYXJ0c1twYXJ0TnVtYmVyXVxuICAgICAgICAgIGlmIChvbGRQYXJ0KSB7XG4gICAgICAgICAgICBpZiAob2xkUGFydC5ldGFnID09PSBtZDUudG9TdHJpbmcoJ2hleCcpKSB7XG4gICAgICAgICAgICAgIGVUYWdzLnB1c2goeyBwYXJ0OiBwYXJ0TnVtYmVyLCBldGFnOiBvbGRQYXJ0LmV0YWcgfSlcbiAgICAgICAgICAgICAgcGFydE51bWJlcisrXG4gICAgICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcGFydE51bWJlcisrXG5cbiAgICAgICAgICAvLyBub3cgc3RhcnQgdG8gdXBsb2FkIG1pc3NpbmcgcGFydFxuICAgICAgICAgIGNvbnN0IG9wdGlvbnM6IFJlcXVlc3RPcHRpb24gPSB7XG4gICAgICAgICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgICAgICAgcXVlcnk6IHFzLnN0cmluZ2lmeSh7IHBhcnROdW1iZXIsIHVwbG9hZElkIH0pLFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAnQ29udGVudC1MZW5ndGgnOiBjaHVuay5sZW5ndGgsXG4gICAgICAgICAgICAgICdDb250ZW50LU1ENSc6IG1kNS50b1N0cmluZygnYmFzZTY0JyksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgYnVja2V0TmFtZSxcbiAgICAgICAgICAgIG9iamVjdE5hbWUsXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KG9wdGlvbnMsIGNodW5rKVxuXG4gICAgICAgICAgbGV0IGV0YWcgPSByZXNwb25zZS5oZWFkZXJzLmV0YWdcbiAgICAgICAgICBpZiAoZXRhZykge1xuICAgICAgICAgICAgZXRhZyA9IGV0YWcucmVwbGFjZSgvXlwiLywgJycpLnJlcGxhY2UoL1wiJC8sICcnKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBldGFnID0gJydcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBlVGFncy5wdXNoKHsgcGFydDogcGFydE51bWJlciwgZXRhZyB9KVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY29tcGxldGVNdWx0aXBhcnRVcGxvYWQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdXBsb2FkSWQsIGVUYWdzKVxuICAgICAgfSkoKSxcbiAgICBdKVxuXG4gICAgcmV0dXJuIG9cbiAgfVxuXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD5cbiAgcmVtb3ZlQnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nLCBjYWxsYmFjazogTm9SZXN1bHRDYWxsYmFjayk6IHZvaWRcbiAgYXN5bmMgcmVtb3ZlQnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBjb25zdCBxdWVyeSA9ICdyZXBsaWNhdGlvbidcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwMCwgMjA0XSwgJycpXG4gIH1cblxuICBzZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIHJlcGxpY2F0aW9uQ29uZmlnOiBSZXBsaWNhdGlvbkNvbmZpZ09wdHMpOiB2b2lkXG4gIGFzeW5jIHNldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgcmVwbGljYXRpb25Db25maWc6IFJlcGxpY2F0aW9uQ29uZmlnT3B0cyk6IFByb21pc2U8dm9pZD5cbiAgYXN5bmMgc2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nLCByZXBsaWNhdGlvbkNvbmZpZzogUmVwbGljYXRpb25Db25maWdPcHRzKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChyZXBsaWNhdGlvbkNvbmZpZykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3JlcGxpY2F0aW9uQ29uZmlnIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoXy5pc0VtcHR5KHJlcGxpY2F0aW9uQ29uZmlnLnJvbGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ1JvbGUgY2Fubm90IGJlIGVtcHR5JylcbiAgICAgIH0gZWxzZSBpZiAocmVwbGljYXRpb25Db25maWcucm9sZSAmJiAhaXNTdHJpbmcocmVwbGljYXRpb25Db25maWcucm9sZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW52YWxpZCB2YWx1ZSBmb3Igcm9sZScsIHJlcGxpY2F0aW9uQ29uZmlnLnJvbGUpXG4gICAgICB9XG4gICAgICBpZiAoXy5pc0VtcHR5KHJlcGxpY2F0aW9uQ29uZmlnLnJ1bGVzKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdNaW5pbXVtIG9uZSByZXBsaWNhdGlvbiBydWxlIG11c3QgYmUgc3BlY2lmaWVkJylcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBxdWVyeSA9ICdyZXBsaWNhdGlvbidcbiAgICBjb25zdCBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge31cblxuICAgIGNvbnN0IHJlcGxpY2F0aW9uUGFyYW1zQ29uZmlnID0ge1xuICAgICAgUmVwbGljYXRpb25Db25maWd1cmF0aW9uOiB7XG4gICAgICAgIFJvbGU6IHJlcGxpY2F0aW9uQ29uZmlnLnJvbGUsXG4gICAgICAgIFJ1bGU6IHJlcGxpY2F0aW9uQ29uZmlnLnJ1bGVzLFxuICAgICAgfSxcbiAgICB9XG5cbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHsgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sIGhlYWRsZXNzOiB0cnVlIH0pXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QocmVwbGljYXRpb25QYXJhbXNDb25maWcpXG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZClcbiAgfVxuXG4gIGdldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZyk6IHZvaWRcbiAgYXN5bmMgZ2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxSZXBsaWNhdGlvbkNvbmZpZz5cbiAgYXN5bmMgZ2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICdyZXBsaWNhdGlvbidcblxuICAgIGNvbnN0IGh0dHBSZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwLCAyMDRdKVxuICAgIGNvbnN0IHhtbFJlc3VsdCA9IGF3YWl0IHJlYWRBc1N0cmluZyhodHRwUmVzKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlUmVwbGljYXRpb25Db25maWcoeG1sUmVzdWx0KVxuICB9XG5cbiAgZ2V0T2JqZWN0TGVnYWxIb2xkKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgZ2V0T3B0cz86IEdldE9iamVjdExlZ2FsSG9sZE9wdGlvbnMsXG4gICAgY2FsbGJhY2s/OiBSZXN1bHRDYWxsYmFjazxMRUdBTF9IT0xEX1NUQVRVUz4sXG4gICk6IFByb21pc2U8TEVHQUxfSE9MRF9TVEFUVVM+XG4gIGFzeW5jIGdldE9iamVjdExlZ2FsSG9sZChcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIGdldE9wdHM/OiBHZXRPYmplY3RMZWdhbEhvbGRPcHRpb25zLFxuICApOiBQcm9taXNlPExFR0FMX0hPTERfU1RBVFVTPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoZ2V0T3B0cykge1xuICAgICAgaWYgKCFpc09iamVjdChnZXRPcHRzKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdnZXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwiT2JqZWN0XCInKVxuICAgICAgfSBlbHNlIGlmIChPYmplY3Qua2V5cyhnZXRPcHRzKS5sZW5ndGggPiAwICYmIGdldE9wdHMudmVyc2lvbklkICYmICFpc1N0cmluZyhnZXRPcHRzLnZlcnNpb25JZCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmVyc2lvbklkIHNob3VsZCBiZSBvZiB0eXBlIHN0cmluZy46JywgZ2V0T3B0cy52ZXJzaW9uSWQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBsZXQgcXVlcnkgPSAnbGVnYWwtaG9sZCdcblxuICAgIGlmIChnZXRPcHRzPy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ICs9IGAmdmVyc2lvbklkPSR7Z2V0T3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cblxuICAgIGNvbnN0IGh0dHBSZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwXSlcbiAgICBjb25zdCBzdHJSZXMgPSBhd2FpdCByZWFkQXNTdHJpbmcoaHR0cFJlcylcbiAgICByZXR1cm4gcGFyc2VPYmplY3RMZWdhbEhvbGRDb25maWcoc3RyUmVzKVxuICB9XG5cbiAgc2V0T2JqZWN0TGVnYWxIb2xkKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBzZXRPcHRzPzogUHV0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyk6IHZvaWRcbiAgYXN5bmMgc2V0T2JqZWN0TGVnYWxIb2xkKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgc2V0T3B0cyA9IHtcbiAgICAgIHN0YXR1czogTEVHQUxfSE9MRF9TVEFUVVMuRU5BQkxFRCxcbiAgICB9IGFzIFB1dE9iamVjdExlZ2FsSG9sZE9wdGlvbnMsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKCFpc09iamVjdChzZXRPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc2V0T3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIk9iamVjdFwiJylcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKCFbTEVHQUxfSE9MRF9TVEFUVVMuRU5BQkxFRCwgTEVHQUxfSE9MRF9TVEFUVVMuRElTQUJMRURdLmluY2x1ZGVzKHNldE9wdHM/LnN0YXR1cykpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignSW52YWxpZCBzdGF0dXM6ICcgKyBzZXRPcHRzLnN0YXR1cylcbiAgICAgIH1cbiAgICAgIGlmIChzZXRPcHRzLnZlcnNpb25JZCAmJiAhc2V0T3B0cy52ZXJzaW9uSWQubGVuZ3RoKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ZlcnNpb25JZCBzaG91bGQgYmUgb2YgdHlwZSBzdHJpbmcuOicgKyBzZXRPcHRzLnZlcnNpb25JZClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGxldCBxdWVyeSA9ICdsZWdhbC1ob2xkJ1xuXG4gICAgaWYgKHNldE9wdHMudmVyc2lvbklkKSB7XG4gICAgICBxdWVyeSArPSBgJnZlcnNpb25JZD0ke3NldE9wdHMudmVyc2lvbklkfWBcbiAgICB9XG5cbiAgICBjb25zdCBjb25maWcgPSB7XG4gICAgICBTdGF0dXM6IHNldE9wdHMuc3RhdHVzLFxuICAgIH1cblxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyByb290TmFtZTogJ0xlZ2FsSG9sZCcsIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LCBoZWFkbGVzczogdHJ1ZSB9KVxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KGNvbmZpZylcbiAgICBjb25zdCBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge31cbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcblxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogR2V0IFRhZ3MgYXNzb2NpYXRlZCB3aXRoIGEgQnVja2V0XG4gICAqL1xuICBhc3luYyBnZXRCdWNrZXRUYWdnaW5nKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8VGFnW10+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAndGFnZ2luZydcbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhyZXF1ZXN0T3B0aW9ucylcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlc3BvbnNlKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlVGFnZ2luZyhib2R5KVxuICB9XG5cbiAgLyoqXG4gICAqICBHZXQgdGhlIHRhZ3MgYXNzb2NpYXRlZCB3aXRoIGEgYnVja2V0IE9SIGFuIG9iamVjdFxuICAgKi9cbiAgYXN5bmMgZ2V0T2JqZWN0VGFnZ2luZyhidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgZ2V0T3B0cz86IEdldE9iamVjdE9wdHMpOiBQcm9taXNlPFRhZ1tdPiB7XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBsZXQgcXVlcnkgPSAndGFnZ2luZydcblxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBvYmplY3QgbmFtZTogJyArIG9iamVjdE5hbWUpXG4gICAgfVxuICAgIGlmIChnZXRPcHRzICYmICFpc09iamVjdChnZXRPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignZ2V0T3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICBpZiAoZ2V0T3B0cyAmJiBnZXRPcHRzLnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgPSBgJHtxdWVyeX0mdmVyc2lvbklkPSR7Z2V0T3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cbiAgICBjb25zdCByZXF1ZXN0T3B0aW9uczogUmVxdWVzdE9wdGlvbiA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9XG4gICAgaWYgKG9iamVjdE5hbWUpIHtcbiAgICAgIHJlcXVlc3RPcHRpb25zWydvYmplY3ROYW1lJ10gPSBvYmplY3ROYW1lXG4gICAgfVxuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMocmVxdWVzdE9wdGlvbnMpXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXNwb25zZSlcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZVRhZ2dpbmcoYm9keSlcbiAgfVxuXG4gIC8qKlxuICAgKiAgU2V0IHRoZSBwb2xpY3kgb24gYSBidWNrZXQgb3IgYW4gb2JqZWN0IHByZWZpeC5cbiAgICovXG4gIGFzeW5jIHNldEJ1Y2tldFBvbGljeShidWNrZXROYW1lOiBzdHJpbmcsIHBvbGljeTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gVmFsaWRhdGUgYXJndW1lbnRzLlxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocG9saWN5KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0UG9saWN5RXJyb3IoYEludmFsaWQgYnVja2V0IHBvbGljeTogJHtwb2xpY3l9IC0gbXVzdCBiZSBcInN0cmluZ1wiYClcbiAgICB9XG5cbiAgICBjb25zdCBxdWVyeSA9ICdwb2xpY3knXG5cbiAgICBsZXQgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBpZiAocG9saWN5KSB7XG4gICAgICBtZXRob2QgPSAnUFVUJ1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sIHBvbGljeSwgWzIwNF0sICcnKVxuICB9XG5cbiAgLyoqXG4gICAqIEdldCB0aGUgcG9saWN5IG9uIGEgYnVja2V0IG9yIGFuIG9iamVjdCBwcmVmaXguXG4gICAqL1xuICBhc3luYyBnZXRCdWNrZXRQb2xpY3koYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICAvLyBWYWxpZGF0ZSBhcmd1bWVudHMuXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3BvbGljeSdcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0pXG4gICAgcmV0dXJuIGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gIH1cblxuICBhc3luYyBwdXRPYmplY3RSZXRlbnRpb24oYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHJldGVudGlvbk9wdHM6IFJldGVudGlvbiA9IHt9KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChyZXRlbnRpb25PcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigncmV0ZW50aW9uT3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHJldGVudGlvbk9wdHMuZ292ZXJuYW5jZUJ5cGFzcyAmJiAhaXNCb29sZWFuKHJldGVudGlvbk9wdHMuZ292ZXJuYW5jZUJ5cGFzcykpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCB2YWx1ZSBmb3IgZ292ZXJuYW5jZUJ5cGFzczogJHtyZXRlbnRpb25PcHRzLmdvdmVybmFuY2VCeXBhc3N9YClcbiAgICAgIH1cbiAgICAgIGlmIChcbiAgICAgICAgcmV0ZW50aW9uT3B0cy5tb2RlICYmXG4gICAgICAgICFbUkVURU5USU9OX01PREVTLkNPTVBMSUFOQ0UsIFJFVEVOVElPTl9NT0RFUy5HT1ZFUk5BTkNFXS5pbmNsdWRlcyhyZXRlbnRpb25PcHRzLm1vZGUpXG4gICAgICApIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCBvYmplY3QgcmV0ZW50aW9uIG1vZGU6ICR7cmV0ZW50aW9uT3B0cy5tb2RlfWApXG4gICAgICB9XG4gICAgICBpZiAocmV0ZW50aW9uT3B0cy5yZXRhaW5VbnRpbERhdGUgJiYgIWlzU3RyaW5nKHJldGVudGlvbk9wdHMucmV0YWluVW50aWxEYXRlKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHZhbHVlIGZvciByZXRhaW5VbnRpbERhdGU6ICR7cmV0ZW50aW9uT3B0cy5yZXRhaW5VbnRpbERhdGV9YClcbiAgICAgIH1cbiAgICAgIGlmIChyZXRlbnRpb25PcHRzLnZlcnNpb25JZCAmJiAhaXNTdHJpbmcocmV0ZW50aW9uT3B0cy52ZXJzaW9uSWQpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgdmFsdWUgZm9yIHZlcnNpb25JZDogJHtyZXRlbnRpb25PcHRzLnZlcnNpb25JZH1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ3JldGVudGlvbidcblxuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cbiAgICBpZiAocmV0ZW50aW9uT3B0cy5nb3Zlcm5hbmNlQnlwYXNzKSB7XG4gICAgICBoZWFkZXJzWydYLUFtei1CeXBhc3MtR292ZXJuYW5jZS1SZXRlbnRpb24nXSA9IHRydWVcbiAgICB9XG5cbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHsgcm9vdE5hbWU6ICdSZXRlbnRpb24nLCByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSwgaGVhZGxlc3M6IHRydWUgfSlcbiAgICBjb25zdCBwYXJhbXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fVxuXG4gICAgaWYgKHJldGVudGlvbk9wdHMubW9kZSkge1xuICAgICAgcGFyYW1zLk1vZGUgPSByZXRlbnRpb25PcHRzLm1vZGVcbiAgICB9XG4gICAgaWYgKHJldGVudGlvbk9wdHMucmV0YWluVW50aWxEYXRlKSB7XG4gICAgICBwYXJhbXMuUmV0YWluVW50aWxEYXRlID0gcmV0ZW50aW9uT3B0cy5yZXRhaW5VbnRpbERhdGVcbiAgICB9XG4gICAgaWYgKHJldGVudGlvbk9wdHMudmVyc2lvbklkKSB7XG4gICAgICBxdWVyeSArPSBgJnZlcnNpb25JZD0ke3JldGVudGlvbk9wdHMudmVyc2lvbklkfWBcbiAgICB9XG5cbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChwYXJhbXMpXG5cbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkLCBbMjAwLCAyMDRdKVxuICB9XG5cbiAgZ2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcsIGNhbGxiYWNrOiBSZXN1bHRDYWxsYmFjazxPYmplY3RMb2NrSW5mbz4pOiB2b2lkXG4gIGdldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZTogc3RyaW5nKTogdm9pZFxuICBhc3luYyBnZXRPYmplY3RMb2NrQ29uZmlnKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8T2JqZWN0TG9ja0luZm8+XG4gIGFzeW5jIGdldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZTogc3RyaW5nKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICdvYmplY3QtbG9jaydcblxuICAgIGNvbnN0IGh0dHBSZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0pXG4gICAgY29uc3QgeG1sUmVzdWx0ID0gYXdhaXQgcmVhZEFzU3RyaW5nKGh0dHBSZXMpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VPYmplY3RMb2NrQ29uZmlnKHhtbFJlc3VsdClcbiAgfVxuXG4gIHNldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZTogc3RyaW5nLCBsb2NrQ29uZmlnT3B0czogT21pdDxPYmplY3RMb2NrSW5mbywgJ29iamVjdExvY2tFbmFibGVkJz4pOiB2b2lkXG4gIGFzeW5jIHNldE9iamVjdExvY2tDb25maWcoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIGxvY2tDb25maWdPcHRzOiBPbWl0PE9iamVjdExvY2tJbmZvLCAnb2JqZWN0TG9ja0VuYWJsZWQnPixcbiAgKTogUHJvbWlzZTx2b2lkPlxuICBhc3luYyBzZXRPYmplY3RMb2NrQ29uZmlnKGJ1Y2tldE5hbWU6IHN0cmluZywgbG9ja0NvbmZpZ09wdHM6IE9taXQ8T2JqZWN0TG9ja0luZm8sICdvYmplY3RMb2NrRW5hYmxlZCc+KSB7XG4gICAgY29uc3QgcmV0ZW50aW9uTW9kZXMgPSBbUkVURU5USU9OX01PREVTLkNPTVBMSUFOQ0UsIFJFVEVOVElPTl9NT0RFUy5HT1ZFUk5BTkNFXVxuICAgIGNvbnN0IHZhbGlkVW5pdHMgPSBbUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLkRBWVMsIFJFVEVOVElPTl9WQUxJRElUWV9VTklUUy5ZRUFSU11cblxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuXG4gICAgaWYgKGxvY2tDb25maWdPcHRzLm1vZGUgJiYgIXJldGVudGlvbk1vZGVzLmluY2x1ZGVzKGxvY2tDb25maWdPcHRzLm1vZGUpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBsb2NrQ29uZmlnT3B0cy5tb2RlIHNob3VsZCBiZSBvbmUgb2YgJHtyZXRlbnRpb25Nb2Rlc31gKVxuICAgIH1cbiAgICBpZiAobG9ja0NvbmZpZ09wdHMudW5pdCAmJiAhdmFsaWRVbml0cy5pbmNsdWRlcyhsb2NrQ29uZmlnT3B0cy51bml0KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgbG9ja0NvbmZpZ09wdHMudW5pdCBzaG91bGQgYmUgb25lIG9mICR7dmFsaWRVbml0c31gKVxuICAgIH1cbiAgICBpZiAobG9ja0NvbmZpZ09wdHMudmFsaWRpdHkgJiYgIWlzTnVtYmVyKGxvY2tDb25maWdPcHRzLnZhbGlkaXR5KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgbG9ja0NvbmZpZ09wdHMudmFsaWRpdHkgc2hvdWxkIGJlIGEgbnVtYmVyYClcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ29iamVjdC1sb2NrJ1xuXG4gICAgY29uc3QgY29uZmlnOiBPYmplY3RMb2NrQ29uZmlnUGFyYW0gPSB7XG4gICAgICBPYmplY3RMb2NrRW5hYmxlZDogJ0VuYWJsZWQnLFxuICAgIH1cbiAgICBjb25zdCBjb25maWdLZXlzID0gT2JqZWN0LmtleXMobG9ja0NvbmZpZ09wdHMpXG5cbiAgICBjb25zdCBpc0FsbEtleXNTZXQgPSBbJ3VuaXQnLCAnbW9kZScsICd2YWxpZGl0eSddLmV2ZXJ5KChsY2spID0+IGNvbmZpZ0tleXMuaW5jbHVkZXMobGNrKSlcbiAgICAvLyBDaGVjayBpZiBrZXlzIGFyZSBwcmVzZW50IGFuZCBhbGwga2V5cyBhcmUgcHJlc2VudC5cbiAgICBpZiAoY29uZmlnS2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICBpZiAoIWlzQWxsS2V5c1NldCkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFxuICAgICAgICAgIGBsb2NrQ29uZmlnT3B0cy5tb2RlLGxvY2tDb25maWdPcHRzLnVuaXQsbG9ja0NvbmZpZ09wdHMudmFsaWRpdHkgYWxsIHRoZSBwcm9wZXJ0aWVzIHNob3VsZCBiZSBzcGVjaWZpZWQuYCxcbiAgICAgICAgKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uZmlnLlJ1bGUgPSB7XG4gICAgICAgICAgRGVmYXVsdFJldGVudGlvbjoge30sXG4gICAgICAgIH1cbiAgICAgICAgaWYgKGxvY2tDb25maWdPcHRzLm1vZGUpIHtcbiAgICAgICAgICBjb25maWcuUnVsZS5EZWZhdWx0UmV0ZW50aW9uLk1vZGUgPSBsb2NrQ29uZmlnT3B0cy5tb2RlXG4gICAgICAgIH1cbiAgICAgICAgaWYgKGxvY2tDb25maWdPcHRzLnVuaXQgPT09IFJFVEVOVElPTl9WQUxJRElUWV9VTklUUy5EQVlTKSB7XG4gICAgICAgICAgY29uZmlnLlJ1bGUuRGVmYXVsdFJldGVudGlvbi5EYXlzID0gbG9ja0NvbmZpZ09wdHMudmFsaWRpdHlcbiAgICAgICAgfSBlbHNlIGlmIChsb2NrQ29uZmlnT3B0cy51bml0ID09PSBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMuWUVBUlMpIHtcbiAgICAgICAgICBjb25maWcuUnVsZS5EZWZhdWx0UmV0ZW50aW9uLlllYXJzID0gbG9ja0NvbmZpZ09wdHMudmFsaWRpdHlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xuICAgICAgcm9vdE5hbWU6ICdPYmplY3RMb2NrQ29uZmlndXJhdGlvbicsXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxuICAgIH0pXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoY29uZmlnKVxuXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZClcbiAgfVxuXG4gIGFzeW5jIGdldEJ1Y2tldFZlcnNpb25pbmcoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxCdWNrZXRWZXJzaW9uaW5nQ29uZmlndXJhdGlvbj4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAndmVyc2lvbmluZydcblxuICAgIGNvbnN0IGh0dHBSZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0pXG4gICAgY29uc3QgeG1sUmVzdWx0ID0gYXdhaXQgcmVhZEFzU3RyaW5nKGh0dHBSZXMpXG4gICAgcmV0dXJuIGF3YWl0IHhtbFBhcnNlcnMucGFyc2VCdWNrZXRWZXJzaW9uaW5nQ29uZmlnKHhtbFJlc3VsdClcbiAgfVxuXG4gIGFzeW5jIHNldEJ1Y2tldFZlcnNpb25pbmcoYnVja2V0TmFtZTogc3RyaW5nLCB2ZXJzaW9uQ29uZmlnOiBCdWNrZXRWZXJzaW9uaW5nQ29uZmlndXJhdGlvbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghT2JqZWN0LmtleXModmVyc2lvbkNvbmZpZykubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd2ZXJzaW9uQ29uZmlnIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgcXVlcnkgPSAndmVyc2lvbmluZydcbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHtcbiAgICAgIHJvb3ROYW1lOiAnVmVyc2lvbmluZ0NvbmZpZ3VyYXRpb24nLFxuICAgICAgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sXG4gICAgICBoZWFkbGVzczogdHJ1ZSxcbiAgICB9KVxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KHZlcnNpb25Db25maWcpXG5cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCBwYXlsb2FkKVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzZXRUYWdnaW5nKHRhZ2dpbmdQYXJhbXM6IFB1dFRhZ2dpbmdQYXJhbXMpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHRhZ3MsIHB1dE9wdHMgfSA9IHRhZ2dpbmdQYXJhbXNcbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGxldCBxdWVyeSA9ICd0YWdnaW5nJ1xuXG4gICAgaWYgKHB1dE9wdHMgJiYgcHV0T3B0cz8udmVyc2lvbklkKSB7XG4gICAgICBxdWVyeSA9IGAke3F1ZXJ5fSZ2ZXJzaW9uSWQ9JHtwdXRPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuICAgIGNvbnN0IHRhZ3NMaXN0ID0gW11cbiAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyh0YWdzKSkge1xuICAgICAgdGFnc0xpc3QucHVzaCh7IEtleToga2V5LCBWYWx1ZTogdmFsdWUgfSlcbiAgICB9XG4gICAgY29uc3QgdGFnZ2luZ0NvbmZpZyA9IHtcbiAgICAgIFRhZ2dpbmc6IHtcbiAgICAgICAgVGFnU2V0OiB7XG4gICAgICAgICAgVGFnOiB0YWdzTGlzdCxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfVxuICAgIGNvbnN0IGhlYWRlcnMgPSB7fSBhcyBSZXF1ZXN0SGVhZGVyc1xuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyBoZWFkbGVzczogdHJ1ZSwgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0gfSlcbiAgICBjb25zdCBwYXlsb2FkQnVmID0gQnVmZmVyLmZyb20oYnVpbGRlci5idWlsZE9iamVjdCh0YWdnaW5nQ29uZmlnKSlcbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHtcbiAgICAgIG1ldGhvZCxcbiAgICAgIGJ1Y2tldE5hbWUsXG4gICAgICBxdWVyeSxcbiAgICAgIGhlYWRlcnMsXG5cbiAgICAgIC4uLihvYmplY3ROYW1lICYmIHsgb2JqZWN0TmFtZTogb2JqZWN0TmFtZSB9KSxcbiAgICB9XG5cbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZEJ1ZilcblxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQocmVxdWVzdE9wdGlvbnMsIHBheWxvYWRCdWYpXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlbW92ZVRhZ2dpbmcoeyBidWNrZXROYW1lLCBvYmplY3ROYW1lLCByZW1vdmVPcHRzIH06IFJlbW92ZVRhZ2dpbmdQYXJhbXMpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGxldCBxdWVyeSA9ICd0YWdnaW5nJ1xuXG4gICAgaWYgKHJlbW92ZU9wdHMgJiYgT2JqZWN0LmtleXMocmVtb3ZlT3B0cykubGVuZ3RoICYmIHJlbW92ZU9wdHMudmVyc2lvbklkKSB7XG4gICAgICBxdWVyeSA9IGAke3F1ZXJ5fSZ2ZXJzaW9uSWQ9JHtyZW1vdmVPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH1cblxuICAgIGlmIChvYmplY3ROYW1lKSB7XG4gICAgICByZXF1ZXN0T3B0aW9uc1snb2JqZWN0TmFtZSddID0gb2JqZWN0TmFtZVxuICAgIH1cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMocmVxdWVzdE9wdGlvbnMsICcnLCBbMjAwLCAyMDRdKVxuICB9XG5cbiAgYXN5bmMgc2V0QnVja2V0VGFnZ2luZyhidWNrZXROYW1lOiBzdHJpbmcsIHRhZ3M6IFRhZ3MpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KHRhZ3MpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd0YWdzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoT2JqZWN0LmtleXModGFncykubGVuZ3RoID4gMTApIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ21heGltdW0gdGFncyBhbGxvd2VkIGlzIDEwXCInKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2V0VGFnZ2luZyh7IGJ1Y2tldE5hbWUsIHRhZ3MgfSlcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldFRhZ2dpbmcoYnVja2V0TmFtZTogc3RyaW5nKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgYXdhaXQgdGhpcy5yZW1vdmVUYWdnaW5nKHsgYnVja2V0TmFtZSB9KVxuICB9XG5cbiAgYXN5bmMgc2V0T2JqZWN0VGFnZ2luZyhidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgdGFnczogVGFncywgcHV0T3B0cz86IFRhZ2dpbmdPcHRzKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIG9iamVjdCBuYW1lOiAnICsgb2JqZWN0TmFtZSlcbiAgICB9XG5cbiAgICBpZiAoIWlzT2JqZWN0KHRhZ3MpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd0YWdzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoT2JqZWN0LmtleXModGFncykubGVuZ3RoID4gMTApIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ01heGltdW0gdGFncyBhbGxvd2VkIGlzIDEwXCInKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2V0VGFnZ2luZyh7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHRhZ3MsIHB1dE9wdHMgfSlcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZU9iamVjdFRhZ2dpbmcoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHJlbW92ZU9wdHM6IFRhZ2dpbmdPcHRzKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIG9iamVjdCBuYW1lOiAnICsgb2JqZWN0TmFtZSlcbiAgICB9XG4gICAgaWYgKHJlbW92ZU9wdHMgJiYgT2JqZWN0LmtleXMocmVtb3ZlT3B0cykubGVuZ3RoICYmICFpc09iamVjdChyZW1vdmVPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigncmVtb3ZlT3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJlbW92ZVRhZ2dpbmcoeyBidWNrZXROYW1lLCBvYmplY3ROYW1lLCByZW1vdmVPcHRzIH0pXG4gIH1cblxuICBhc3luYyBzZWxlY3RPYmplY3RDb250ZW50KFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgc2VsZWN0T3B0czogU2VsZWN0T3B0aW9ucyxcbiAgKTogUHJvbWlzZTxTZWxlY3RSZXN1bHRzIHwgdW5kZWZpbmVkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFfLmlzRW1wdHkoc2VsZWN0T3B0cykpIHtcbiAgICAgIGlmICghaXNTdHJpbmcoc2VsZWN0T3B0cy5leHByZXNzaW9uKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzcWxFeHByZXNzaW9uIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgICAgfVxuICAgICAgaWYgKCFfLmlzRW1wdHkoc2VsZWN0T3B0cy5pbnB1dFNlcmlhbGl6YXRpb24pKSB7XG4gICAgICAgIGlmICghaXNPYmplY3Qoc2VsZWN0T3B0cy5pbnB1dFNlcmlhbGl6YXRpb24pKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignaW5wdXRTZXJpYWxpemF0aW9uIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdpbnB1dFNlcmlhbGl6YXRpb24gaXMgcmVxdWlyZWQnKVxuICAgICAgfVxuICAgICAgaWYgKCFfLmlzRW1wdHkoc2VsZWN0T3B0cy5vdXRwdXRTZXJpYWxpemF0aW9uKSkge1xuICAgICAgICBpZiAoIWlzT2JqZWN0KHNlbGVjdE9wdHMub3V0cHV0U2VyaWFsaXphdGlvbikpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvdXRwdXRTZXJpYWxpemF0aW9uIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvdXRwdXRTZXJpYWxpemF0aW9uIGlzIHJlcXVpcmVkJylcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmFsaWQgc2VsZWN0IGNvbmZpZ3VyYXRpb24gaXMgcmVxdWlyZWQnKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQT1NUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gYHNlbGVjdCZzZWxlY3QtdHlwZT0yYFxuXG4gICAgY29uc3QgY29uZmlnOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdID0gW1xuICAgICAge1xuICAgICAgICBFeHByZXNzaW9uOiBzZWxlY3RPcHRzLmV4cHJlc3Npb24sXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBFeHByZXNzaW9uVHlwZTogc2VsZWN0T3B0cy5leHByZXNzaW9uVHlwZSB8fCAnU1FMJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIElucHV0U2VyaWFsaXphdGlvbjogW3NlbGVjdE9wdHMuaW5wdXRTZXJpYWxpemF0aW9uXSxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIE91dHB1dFNlcmlhbGl6YXRpb246IFtzZWxlY3RPcHRzLm91dHB1dFNlcmlhbGl6YXRpb25dLFxuICAgICAgfSxcbiAgICBdXG5cbiAgICAvLyBPcHRpb25hbFxuICAgIGlmIChzZWxlY3RPcHRzLnJlcXVlc3RQcm9ncmVzcykge1xuICAgICAgY29uZmlnLnB1c2goeyBSZXF1ZXN0UHJvZ3Jlc3M6IHNlbGVjdE9wdHM/LnJlcXVlc3RQcm9ncmVzcyB9KVxuICAgIH1cbiAgICAvLyBPcHRpb25hbFxuICAgIGlmIChzZWxlY3RPcHRzLnNjYW5SYW5nZSkge1xuICAgICAgY29uZmlnLnB1c2goeyBTY2FuUmFuZ2U6IHNlbGVjdE9wdHMuc2NhblJhbmdlIH0pXG4gICAgfVxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ1NlbGVjdE9iamVjdENvbnRlbnRSZXF1ZXN0JyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChjb25maWcpXG5cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0sIHBheWxvYWQpXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc0J1ZmZlcihyZXMpXG4gICAgcmV0dXJuIHBhcnNlU2VsZWN0T2JqZWN0Q29udGVudFJlc3BvbnNlKGJvZHkpXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFwcGx5QnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWU6IHN0cmluZywgcG9saWN5Q29uZmlnOiBMaWZlQ3ljbGVDb25maWdQYXJhbSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgcXVlcnkgPSAnbGlmZWN5Y2xlJ1xuXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xuICAgICAgcm9vdE5hbWU6ICdMaWZlY3ljbGVDb25maWd1cmF0aW9uJyxcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxuICAgICAgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sXG4gICAgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChwb2xpY3lDb25maWcpXG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG5cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkKVxuICB9XG5cbiAgYXN5bmMgcmVtb3ZlQnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgY29uc3QgcXVlcnkgPSAnbGlmZWN5Y2xlJ1xuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjA0XSlcbiAgfVxuXG4gIGFzeW5jIHNldEJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lOiBzdHJpbmcsIGxpZmVDeWNsZUNvbmZpZzogTGlmZUN5Y2xlQ29uZmlnUGFyYW0pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoXy5pc0VtcHR5KGxpZmVDeWNsZUNvbmZpZykpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVtb3ZlQnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWUpXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMuYXBwbHlCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZSwgbGlmZUN5Y2xlQ29uZmlnKVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGdldEJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPExpZmVjeWNsZUNvbmZpZyB8IG51bGw+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2xpZmVjeWNsZSdcblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZUxpZmVjeWNsZUNvbmZpZyhib2R5KVxuICB9XG5cbiAgYXN5bmMgc2V0QnVja2V0RW5jcnlwdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIGVuY3J5cHRpb25Db25maWc/OiBFbmNyeXB0aW9uQ29uZmlnKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFfLmlzRW1wdHkoZW5jcnlwdGlvbkNvbmZpZykgJiYgZW5jcnlwdGlvbkNvbmZpZy5SdWxlLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ0ludmFsaWQgUnVsZSBsZW5ndGguIE9ubHkgb25lIHJ1bGUgaXMgYWxsb3dlZC46ICcgKyBlbmNyeXB0aW9uQ29uZmlnLlJ1bGUpXG4gICAgfVxuXG4gICAgbGV0IGVuY3J5cHRpb25PYmogPSBlbmNyeXB0aW9uQ29uZmlnXG4gICAgaWYgKF8uaXNFbXB0eShlbmNyeXB0aW9uQ29uZmlnKSkge1xuICAgICAgZW5jcnlwdGlvbk9iaiA9IHtcbiAgICAgICAgLy8gRGVmYXVsdCBNaW5JTyBTZXJ2ZXIgU3VwcG9ydGVkIFJ1bGVcbiAgICAgICAgUnVsZTogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIEFwcGx5U2VydmVyU2lkZUVuY3J5cHRpb25CeURlZmF1bHQ6IHtcbiAgICAgICAgICAgICAgU1NFQWxnb3JpdGhtOiAnQUVTMjU2JyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2VuY3J5cHRpb24nXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ1NlcnZlclNpZGVFbmNyeXB0aW9uQ29uZmlndXJhdGlvbicsXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxuICAgIH0pXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoZW5jcnlwdGlvbk9iailcblxuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcblxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQpXG4gIH1cblxuICBhc3luYyBnZXRCdWNrZXRFbmNyeXB0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAnZW5jcnlwdGlvbidcblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZUJ1Y2tldEVuY3J5cHRpb25Db25maWcoYm9keSlcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldEVuY3J5cHRpb24oYnVja2V0TmFtZTogc3RyaW5nKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBjb25zdCBxdWVyeSA9ICdlbmNyeXB0aW9uJ1xuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDRdKVxuICB9XG5cbiAgYXN5bmMgZ2V0T2JqZWN0UmV0ZW50aW9uKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgZ2V0T3B0cz86IEdldE9iamVjdFJldGVudGlvbk9wdHMsXG4gICk6IFByb21pc2U8T2JqZWN0UmV0ZW50aW9uSW5mbyB8IG51bGwgfCB1bmRlZmluZWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoZ2V0T3B0cyAmJiAhaXNPYmplY3QoZ2V0T3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2dldE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfSBlbHNlIGlmIChnZXRPcHRzPy52ZXJzaW9uSWQgJiYgIWlzU3RyaW5nKGdldE9wdHMudmVyc2lvbklkKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndmVyc2lvbklkIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ3JldGVudGlvbidcbiAgICBpZiAoZ2V0T3B0cz8udmVyc2lvbklkKSB7XG4gICAgICBxdWVyeSArPSBgJnZlcnNpb25JZD0ke2dldE9wdHMudmVyc2lvbklkfWBcbiAgICB9XG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9KVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlT2JqZWN0UmV0ZW50aW9uQ29uZmlnKGJvZHkpXG4gIH1cblxuICBhc3luYyByZW1vdmVPYmplY3RzKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0c0xpc3Q6IFJlbW92ZU9iamVjdHNQYXJhbSk6IFByb21pc2U8UmVtb3ZlT2JqZWN0c1Jlc3BvbnNlW10+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkob2JqZWN0c0xpc3QpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdvYmplY3RzTGlzdCBzaG91bGQgYmUgYSBsaXN0JylcbiAgICB9XG5cbiAgICBjb25zdCBydW5EZWxldGVPYmplY3RzID0gYXN5bmMgKGJhdGNoOiBSZW1vdmVPYmplY3RzUGFyYW0pOiBQcm9taXNlPFJlbW92ZU9iamVjdHNSZXNwb25zZVtdPiA9PiB7XG4gICAgICBjb25zdCBkZWxPYmplY3RzOiBSZW1vdmVPYmplY3RzUmVxdWVzdEVudHJ5W10gPSBiYXRjaC5tYXAoKHZhbHVlKSA9PiB7XG4gICAgICAgIHJldHVybiBpc09iamVjdCh2YWx1ZSkgPyB7IEtleTogdmFsdWUubmFtZSwgVmVyc2lvbklkOiB2YWx1ZS52ZXJzaW9uSWQgfSA6IHsgS2V5OiB2YWx1ZSB9XG4gICAgICB9KVxuXG4gICAgICBjb25zdCByZW1PYmplY3RzID0geyBEZWxldGU6IHsgUXVpZXQ6IHRydWUsIE9iamVjdDogZGVsT2JqZWN0cyB9IH1cbiAgICAgIGNvbnN0IHBheWxvYWQgPSBCdWZmZXIuZnJvbShuZXcgeG1sMmpzLkJ1aWxkZXIoeyBoZWFkbGVzczogdHJ1ZSB9KS5idWlsZE9iamVjdChyZW1PYmplY3RzKSlcbiAgICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0geyAnQ29udGVudC1NRDUnOiB0b01kNShwYXlsb2FkKSB9XG5cbiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZDogJ1BPU1QnLCBidWNrZXROYW1lLCBxdWVyeTogJ2RlbGV0ZScsIGhlYWRlcnMgfSwgcGF5bG9hZClcbiAgICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgICAgcmV0dXJuIHhtbFBhcnNlcnMucmVtb3ZlT2JqZWN0c1BhcnNlcihib2R5KVxuICAgIH1cblxuICAgIGNvbnN0IG1heEVudHJpZXMgPSAxMDAwIC8vIG1heCBlbnRyaWVzIGFjY2VwdGVkIGluIHNlcnZlciBmb3IgRGVsZXRlTXVsdGlwbGVPYmplY3RzIEFQSS5cbiAgICAvLyBDbGllbnQgc2lkZSBiYXRjaGluZ1xuICAgIGNvbnN0IGJhdGNoZXMgPSBbXVxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgb2JqZWN0c0xpc3QubGVuZ3RoOyBpICs9IG1heEVudHJpZXMpIHtcbiAgICAgIGJhdGNoZXMucHVzaChvYmplY3RzTGlzdC5zbGljZShpLCBpICsgbWF4RW50cmllcykpXG4gICAgfVxuXG4gICAgY29uc3QgYmF0Y2hSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwoYmF0Y2hlcy5tYXAocnVuRGVsZXRlT2JqZWN0cykpXG4gICAgcmV0dXJuIGJhdGNoUmVzdWx0cy5mbGF0KClcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZUluY29tcGxldGVVcGxvYWQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLklzVmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBjb25zdCByZW1vdmVVcGxvYWRJZCA9IGF3YWl0IHRoaXMuZmluZFVwbG9hZElkKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUpXG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBjb25zdCBxdWVyeSA9IGB1cGxvYWRJZD0ke3JlbW92ZVVwbG9hZElkfWBcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9LCAnJywgWzIwNF0pXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNvcHlPYmplY3RWMShcbiAgICB0YXJnZXRCdWNrZXROYW1lOiBzdHJpbmcsXG4gICAgdGFyZ2V0T2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIHNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgY29uZGl0aW9ucz86IG51bGwgfCBDb3B5Q29uZGl0aW9ucyxcbiAgKSB7XG4gICAgaWYgKHR5cGVvZiBjb25kaXRpb25zID09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNvbmRpdGlvbnMgPSBudWxsXG4gICAgfVxuXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZSh0YXJnZXRCdWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgdGFyZ2V0QnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZSh0YXJnZXRPYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke3RhcmdldE9iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWUgPT09ICcnKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRQcmVmaXhFcnJvcihgRW1wdHkgc291cmNlIHByZWZpeGApXG4gICAgfVxuXG4gICAgaWYgKGNvbmRpdGlvbnMgIT0gbnVsbCAmJiAhKGNvbmRpdGlvbnMgaW5zdGFuY2VvZiBDb3B5Q29uZGl0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NvbmRpdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJDb3B5Q29uZGl0aW9uc1wiJylcbiAgICB9XG5cbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XG4gICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UnXSA9IHVyaVJlc291cmNlRXNjYXBlKHNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lKVxuXG4gICAgaWYgKGNvbmRpdGlvbnMpIHtcbiAgICAgIGlmIChjb25kaXRpb25zLm1vZGlmaWVkICE9PSAnJykge1xuICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS1pZi1tb2RpZmllZC1zaW5jZSddID0gY29uZGl0aW9ucy5tb2RpZmllZFxuICAgICAgfVxuICAgICAgaWYgKGNvbmRpdGlvbnMudW5tb2RpZmllZCAhPT0gJycpIHtcbiAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtaWYtdW5tb2RpZmllZC1zaW5jZSddID0gY29uZGl0aW9ucy51bm1vZGlmaWVkXG4gICAgICB9XG4gICAgICBpZiAoY29uZGl0aW9ucy5tYXRjaEVUYWcgIT09ICcnKSB7XG4gICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLWlmLW1hdGNoJ10gPSBjb25kaXRpb25zLm1hdGNoRVRhZ1xuICAgICAgfVxuICAgICAgaWYgKGNvbmRpdGlvbnMubWF0Y2hFVGFnRXhjZXB0ICE9PSAnJykge1xuICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS1pZi1ub25lLW1hdGNoJ10gPSBjb25kaXRpb25zLm1hdGNoRVRhZ0V4Y2VwdFxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG5cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoe1xuICAgICAgbWV0aG9kLFxuICAgICAgYnVja2V0TmFtZTogdGFyZ2V0QnVja2V0TmFtZSxcbiAgICAgIG9iamVjdE5hbWU6IHRhcmdldE9iamVjdE5hbWUsXG4gICAgICBoZWFkZXJzLFxuICAgIH0pXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VDb3B5T2JqZWN0KGJvZHkpXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNvcHlPYmplY3RWMihcbiAgICBzb3VyY2VDb25maWc6IENvcHlTb3VyY2VPcHRpb25zLFxuICAgIGRlc3RDb25maWc6IENvcHlEZXN0aW5hdGlvbk9wdGlvbnMsXG4gICk6IFByb21pc2U8Q29weU9iamVjdFJlc3VsdFYyPiB7XG4gICAgaWYgKCEoc291cmNlQ29uZmlnIGluc3RhbmNlb2YgQ29weVNvdXJjZU9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdzb3VyY2VDb25maWcgc2hvdWxkIG9mIHR5cGUgQ29weVNvdXJjZU9wdGlvbnMgJylcbiAgICB9XG4gICAgaWYgKCEoZGVzdENvbmZpZyBpbnN0YW5jZW9mIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdkZXN0Q29uZmlnIHNob3VsZCBvZiB0eXBlIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMgJylcbiAgICB9XG4gICAgaWYgKCFkZXN0Q29uZmlnLnZhbGlkYXRlKCkpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdCgpXG4gICAgfVxuICAgIGlmICghZGVzdENvbmZpZy52YWxpZGF0ZSgpKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoKVxuICAgIH1cblxuICAgIGNvbnN0IGhlYWRlcnMgPSBPYmplY3QuYXNzaWduKHt9LCBzb3VyY2VDb25maWcuZ2V0SGVhZGVycygpLCBkZXN0Q29uZmlnLmdldEhlYWRlcnMoKSlcblxuICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBkZXN0Q29uZmlnLkJ1Y2tldFxuICAgIGNvbnN0IG9iamVjdE5hbWUgPSBkZXN0Q29uZmlnLk9iamVjdFxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycyB9KVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgIGNvbnN0IGNvcHlSZXMgPSB4bWxQYXJzZXJzLnBhcnNlQ29weU9iamVjdChib2R5KVxuICAgIGNvbnN0IHJlc0hlYWRlcnM6IEluY29taW5nSHR0cEhlYWRlcnMgPSByZXMuaGVhZGVyc1xuXG4gICAgY29uc3Qgc2l6ZUhlYWRlclZhbHVlID0gcmVzSGVhZGVycyAmJiByZXNIZWFkZXJzWydjb250ZW50LWxlbmd0aCddXG4gICAgY29uc3Qgc2l6ZSA9IHR5cGVvZiBzaXplSGVhZGVyVmFsdWUgPT09ICdudW1iZXInID8gc2l6ZUhlYWRlclZhbHVlIDogdW5kZWZpbmVkXG5cbiAgICByZXR1cm4ge1xuICAgICAgQnVja2V0OiBkZXN0Q29uZmlnLkJ1Y2tldCxcbiAgICAgIEtleTogZGVzdENvbmZpZy5PYmplY3QsXG4gICAgICBMYXN0TW9kaWZpZWQ6IGNvcHlSZXMubGFzdE1vZGlmaWVkLFxuICAgICAgTWV0YURhdGE6IGV4dHJhY3RNZXRhZGF0YShyZXNIZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcbiAgICAgIFZlcnNpb25JZDogZ2V0VmVyc2lvbklkKHJlc0hlYWRlcnMgYXMgUmVzcG9uc2VIZWFkZXIpLFxuICAgICAgU291cmNlVmVyc2lvbklkOiBnZXRTb3VyY2VWZXJzaW9uSWQocmVzSGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXG4gICAgICBFdGFnOiBzYW5pdGl6ZUVUYWcocmVzSGVhZGVycy5ldGFnKSxcbiAgICAgIFNpemU6IHNpemUsXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgY29weU9iamVjdChzb3VyY2U6IENvcHlTb3VyY2VPcHRpb25zLCBkZXN0OiBDb3B5RGVzdGluYXRpb25PcHRpb25zKTogUHJvbWlzZTxDb3B5T2JqZWN0UmVzdWx0PlxuICBhc3luYyBjb3B5T2JqZWN0KFxuICAgIHRhcmdldEJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICB0YXJnZXRPYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBjb25kaXRpb25zPzogQ29weUNvbmRpdGlvbnMsXG4gICk6IFByb21pc2U8Q29weU9iamVjdFJlc3VsdD5cbiAgYXN5bmMgY29weU9iamVjdCguLi5hbGxBcmdzOiBDb3B5T2JqZWN0UGFyYW1zKTogUHJvbWlzZTxDb3B5T2JqZWN0UmVzdWx0PiB7XG4gICAgaWYgKHR5cGVvZiBhbGxBcmdzWzBdID09PSAnc3RyaW5nJykge1xuICAgICAgY29uc3QgW3RhcmdldEJ1Y2tldE5hbWUsIHRhcmdldE9iamVjdE5hbWUsIHNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lLCBjb25kaXRpb25zXSA9IGFsbEFyZ3MgYXMgW1xuICAgICAgICBzdHJpbmcsXG4gICAgICAgIHN0cmluZyxcbiAgICAgICAgc3RyaW5nLFxuICAgICAgICBDb3B5Q29uZGl0aW9ucz8sXG4gICAgICBdXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb3B5T2JqZWN0VjEodGFyZ2V0QnVja2V0TmFtZSwgdGFyZ2V0T2JqZWN0TmFtZSwgc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWUsIGNvbmRpdGlvbnMpXG4gICAgfVxuICAgIGNvbnN0IFtzb3VyY2UsIGRlc3RdID0gYWxsQXJncyBhcyBbQ29weVNvdXJjZU9wdGlvbnMsIENvcHlEZXN0aW5hdGlvbk9wdGlvbnNdXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY29weU9iamVjdFYyKHNvdXJjZSwgZGVzdClcbiAgfVxuXG4gIGFzeW5jIHVwbG9hZFBhcnQoXG4gICAgcGFydENvbmZpZzoge1xuICAgICAgYnVja2V0TmFtZTogc3RyaW5nXG4gICAgICBvYmplY3ROYW1lOiBzdHJpbmdcbiAgICAgIHVwbG9hZElEOiBzdHJpbmdcbiAgICAgIHBhcnROdW1iZXI6IG51bWJlclxuICAgICAgaGVhZGVyczogUmVxdWVzdEhlYWRlcnNcbiAgICB9LFxuICAgIHBheWxvYWQ/OiBCaW5hcnksXG4gICkge1xuICAgIGNvbnN0IHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdXBsb2FkSUQsIHBhcnROdW1iZXIsIGhlYWRlcnMgfSA9IHBhcnRDb25maWdcblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgcXVlcnkgPSBgdXBsb2FkSWQ9JHt1cGxvYWRJRH0mcGFydE51bWJlcj0ke3BhcnROdW1iZXJ9YFxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWU6IG9iamVjdE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH1cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMocmVxdWVzdE9wdGlvbnMsIHBheWxvYWQpXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gICAgY29uc3QgcGFydFJlcyA9IHVwbG9hZFBhcnRQYXJzZXIoYm9keSlcbiAgICByZXR1cm4ge1xuICAgICAgZXRhZzogc2FuaXRpemVFVGFnKHBhcnRSZXMuRVRhZyksXG4gICAgICBrZXk6IG9iamVjdE5hbWUsXG4gICAgICBwYXJ0OiBwYXJ0TnVtYmVyLFxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGNvbXBvc2VPYmplY3QoXG4gICAgZGVzdE9iakNvbmZpZzogQ29weURlc3RpbmF0aW9uT3B0aW9ucyxcbiAgICBzb3VyY2VPYmpMaXN0OiBDb3B5U291cmNlT3B0aW9uc1tdLFxuICApOiBQcm9taXNlPGJvb2xlYW4gfCB7IGV0YWc6IHN0cmluZzsgdmVyc2lvbklkOiBzdHJpbmcgfCBudWxsIH0gfCBQcm9taXNlPHZvaWQ+IHwgQ29weU9iamVjdFJlc3VsdD4ge1xuICAgIGNvbnN0IHNvdXJjZUZpbGVzTGVuZ3RoID0gc291cmNlT2JqTGlzdC5sZW5ndGhcblxuICAgIGlmICghQXJyYXkuaXNBcnJheShzb3VyY2VPYmpMaXN0KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignc291cmNlQ29uZmlnIHNob3VsZCBhbiBhcnJheSBvZiBDb3B5U291cmNlT3B0aW9ucyAnKVxuICAgIH1cbiAgICBpZiAoIShkZXN0T2JqQ29uZmlnIGluc3RhbmNlb2YgQ29weURlc3RpbmF0aW9uT3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2Rlc3RDb25maWcgc2hvdWxkIG9mIHR5cGUgQ29weURlc3RpbmF0aW9uT3B0aW9ucyAnKVxuICAgIH1cblxuICAgIGlmIChzb3VyY2VGaWxlc0xlbmd0aCA8IDEgfHwgc291cmNlRmlsZXNMZW5ndGggPiBQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgYFwiVGhlcmUgbXVzdCBiZSBhcyBsZWFzdCBvbmUgYW5kIHVwIHRvICR7UEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVFNfQ09VTlR9IHNvdXJjZSBvYmplY3RzLmAsXG4gICAgICApXG4gICAgfVxuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzb3VyY2VGaWxlc0xlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBzT2JqID0gc291cmNlT2JqTGlzdFtpXSBhcyBDb3B5U291cmNlT3B0aW9uc1xuICAgICAgaWYgKCFzT2JqLnZhbGlkYXRlKCkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCEoZGVzdE9iakNvbmZpZyBhcyBDb3B5RGVzdGluYXRpb25PcHRpb25zKS52YWxpZGF0ZSgpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICBjb25zdCBnZXRTdGF0T3B0aW9ucyA9IChzcmNDb25maWc6IENvcHlTb3VyY2VPcHRpb25zKSA9PiB7XG4gICAgICBsZXQgc3RhdE9wdHMgPSB7fVxuICAgICAgaWYgKCFfLmlzRW1wdHkoc3JjQ29uZmlnLlZlcnNpb25JRCkpIHtcbiAgICAgICAgc3RhdE9wdHMgPSB7XG4gICAgICAgICAgdmVyc2lvbklkOiBzcmNDb25maWcuVmVyc2lvbklELFxuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gc3RhdE9wdHNcbiAgICB9XG4gICAgY29uc3Qgc3JjT2JqZWN0U2l6ZXM6IG51bWJlcltdID0gW11cbiAgICBsZXQgdG90YWxTaXplID0gMFxuICAgIGxldCB0b3RhbFBhcnRzID0gMFxuXG4gICAgY29uc3Qgc291cmNlT2JqU3RhdHMgPSBzb3VyY2VPYmpMaXN0Lm1hcCgoc3JjSXRlbSkgPT5cbiAgICAgIHRoaXMuc3RhdE9iamVjdChzcmNJdGVtLkJ1Y2tldCwgc3JjSXRlbS5PYmplY3QsIGdldFN0YXRPcHRpb25zKHNyY0l0ZW0pKSxcbiAgICApXG5cbiAgICBjb25zdCBzcmNPYmplY3RJbmZvcyA9IGF3YWl0IFByb21pc2UuYWxsKHNvdXJjZU9ialN0YXRzKVxuXG4gICAgY29uc3QgdmFsaWRhdGVkU3RhdHMgPSBzcmNPYmplY3RJbmZvcy5tYXAoKHJlc0l0ZW1TdGF0LCBpbmRleCkgPT4ge1xuICAgICAgY29uc3Qgc3JjQ29uZmlnOiBDb3B5U291cmNlT3B0aW9ucyB8IHVuZGVmaW5lZCA9IHNvdXJjZU9iakxpc3RbaW5kZXhdXG5cbiAgICAgIGxldCBzcmNDb3B5U2l6ZSA9IHJlc0l0ZW1TdGF0LnNpemVcbiAgICAgIC8vIENoZWNrIGlmIGEgc2VnbWVudCBpcyBzcGVjaWZpZWQsIGFuZCBpZiBzbywgaXMgdGhlXG4gICAgICAvLyBzZWdtZW50IHdpdGhpbiBvYmplY3QgYm91bmRzP1xuICAgICAgaWYgKHNyY0NvbmZpZyAmJiBzcmNDb25maWcuTWF0Y2hSYW5nZSkge1xuICAgICAgICAvLyBTaW5jZSByYW5nZSBpcyBzcGVjaWZpZWQsXG4gICAgICAgIC8vICAgIDAgPD0gc3JjLnNyY1N0YXJ0IDw9IHNyYy5zcmNFbmRcbiAgICAgICAgLy8gc28gb25seSBpbnZhbGlkIGNhc2UgdG8gY2hlY2sgaXM6XG4gICAgICAgIGNvbnN0IHNyY1N0YXJ0ID0gc3JjQ29uZmlnLlN0YXJ0XG4gICAgICAgIGNvbnN0IHNyY0VuZCA9IHNyY0NvbmZpZy5FbmRcbiAgICAgICAgaWYgKHNyY0VuZCA+PSBzcmNDb3B5U2l6ZSB8fCBzcmNTdGFydCA8IDApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICAgICAgYENvcHlTcmNPcHRpb25zICR7aW5kZXh9IGhhcyBpbnZhbGlkIHNlZ21lbnQtdG8tY29weSBbJHtzcmNTdGFydH0sICR7c3JjRW5kfV0gKHNpemUgaXMgJHtzcmNDb3B5U2l6ZX0pYCxcbiAgICAgICAgICApXG4gICAgICAgIH1cbiAgICAgICAgc3JjQ29weVNpemUgPSBzcmNFbmQgLSBzcmNTdGFydCArIDFcbiAgICAgIH1cblxuICAgICAgLy8gT25seSB0aGUgbGFzdCBzb3VyY2UgbWF5IGJlIGxlc3MgdGhhbiBgYWJzTWluUGFydFNpemVgXG4gICAgICBpZiAoc3JjQ29weVNpemUgPCBQQVJUX0NPTlNUUkFJTlRTLkFCU19NSU5fUEFSVF9TSVpFICYmIGluZGV4IDwgc291cmNlRmlsZXNMZW5ndGggLSAxKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgICAgYENvcHlTcmNPcHRpb25zICR7aW5kZXh9IGlzIHRvbyBzbWFsbCAoJHtzcmNDb3B5U2l6ZX0pIGFuZCBpdCBpcyBub3QgdGhlIGxhc3QgcGFydC5gLFxuICAgICAgICApXG4gICAgICB9XG5cbiAgICAgIC8vIElzIGRhdGEgdG8gY29weSB0b28gbGFyZ2U/XG4gICAgICB0b3RhbFNpemUgKz0gc3JjQ29weVNpemVcbiAgICAgIGlmICh0b3RhbFNpemUgPiBQQVJUX0NPTlNUUkFJTlRTLk1BWF9NVUxUSVBBUlRfUFVUX09CSkVDVF9TSVpFKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYENhbm5vdCBjb21wb3NlIGFuIG9iamVjdCBvZiBzaXplICR7dG90YWxTaXplfSAoPiA1VGlCKWApXG4gICAgICB9XG5cbiAgICAgIC8vIHJlY29yZCBzb3VyY2Ugc2l6ZVxuICAgICAgc3JjT2JqZWN0U2l6ZXNbaW5kZXhdID0gc3JjQ29weVNpemVcblxuICAgICAgLy8gY2FsY3VsYXRlIHBhcnRzIG5lZWRlZCBmb3IgY3VycmVudCBzb3VyY2VcbiAgICAgIHRvdGFsUGFydHMgKz0gcGFydHNSZXF1aXJlZChzcmNDb3B5U2l6ZSlcbiAgICAgIC8vIERvIHdlIG5lZWQgbW9yZSBwYXJ0cyB0aGFuIHdlIGFyZSBhbGxvd2VkP1xuICAgICAgaWYgKHRvdGFsUGFydHMgPiBQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVCkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICAgIGBZb3VyIHByb3Bvc2VkIGNvbXBvc2Ugb2JqZWN0IHJlcXVpcmVzIG1vcmUgdGhhbiAke1BBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRTX0NPVU5UfSBwYXJ0c2AsXG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlc0l0ZW1TdGF0XG4gICAgfSlcblxuICAgIGlmICgodG90YWxQYXJ0cyA9PT0gMSAmJiB0b3RhbFNpemUgPD0gUEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVF9TSVpFKSB8fCB0b3RhbFNpemUgPT09IDApIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvcHlPYmplY3Qoc291cmNlT2JqTGlzdFswXSBhcyBDb3B5U291cmNlT3B0aW9ucywgZGVzdE9iakNvbmZpZykgLy8gdXNlIGNvcHlPYmplY3RWMlxuICAgIH1cblxuICAgIC8vIHByZXNlcnZlIGV0YWcgdG8gYXZvaWQgbW9kaWZpY2F0aW9uIG9mIG9iamVjdCB3aGlsZSBjb3B5aW5nLlxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgc291cmNlRmlsZXNMZW5ndGg7IGkrKykge1xuICAgICAgOyhzb3VyY2VPYmpMaXN0W2ldIGFzIENvcHlTb3VyY2VPcHRpb25zKS5NYXRjaEVUYWcgPSAodmFsaWRhdGVkU3RhdHNbaV0gYXMgQnVja2V0SXRlbVN0YXQpLmV0YWdcbiAgICB9XG5cbiAgICBjb25zdCBzcGxpdFBhcnRTaXplTGlzdCA9IHZhbGlkYXRlZFN0YXRzLm1hcCgocmVzSXRlbVN0YXQsIGlkeCkgPT4ge1xuICAgICAgcmV0dXJuIGNhbGN1bGF0ZUV2ZW5TcGxpdHMoc3JjT2JqZWN0U2l6ZXNbaWR4XSBhcyBudW1iZXIsIHNvdXJjZU9iakxpc3RbaWR4XSBhcyBDb3B5U291cmNlT3B0aW9ucylcbiAgICB9KVxuXG4gICAgY29uc3QgZ2V0VXBsb2FkUGFydENvbmZpZ0xpc3QgPSAodXBsb2FkSWQ6IHN0cmluZykgPT4ge1xuICAgICAgY29uc3QgdXBsb2FkUGFydENvbmZpZ0xpc3Q6IFVwbG9hZFBhcnRDb25maWdbXSA9IFtdXG5cbiAgICAgIHNwbGl0UGFydFNpemVMaXN0LmZvckVhY2goKHNwbGl0U2l6ZSwgc3BsaXRJbmRleDogbnVtYmVyKSA9PiB7XG4gICAgICAgIGlmIChzcGxpdFNpemUpIHtcbiAgICAgICAgICBjb25zdCB7IHN0YXJ0SW5kZXg6IHN0YXJ0SWR4LCBlbmRJbmRleDogZW5kSWR4LCBvYmpJbmZvOiBvYmpDb25maWcgfSA9IHNwbGl0U2l6ZVxuXG4gICAgICAgICAgY29uc3QgcGFydEluZGV4ID0gc3BsaXRJbmRleCArIDEgLy8gcGFydCBpbmRleCBzdGFydHMgZnJvbSAxLlxuICAgICAgICAgIGNvbnN0IHRvdGFsVXBsb2FkcyA9IEFycmF5LmZyb20oc3RhcnRJZHgpXG5cbiAgICAgICAgICBjb25zdCBoZWFkZXJzID0gKHNvdXJjZU9iakxpc3Rbc3BsaXRJbmRleF0gYXMgQ29weVNvdXJjZU9wdGlvbnMpLmdldEhlYWRlcnMoKVxuXG4gICAgICAgICAgdG90YWxVcGxvYWRzLmZvckVhY2goKHNwbGl0U3RhcnQsIHVwbGRDdHJJZHgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHNwbGl0RW5kID0gZW5kSWR4W3VwbGRDdHJJZHhdXG5cbiAgICAgICAgICAgIGNvbnN0IHNvdXJjZU9iaiA9IGAke29iakNvbmZpZy5CdWNrZXR9LyR7b2JqQ29uZmlnLk9iamVjdH1gXG4gICAgICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZSddID0gYCR7c291cmNlT2JqfWBcbiAgICAgICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLXJhbmdlJ10gPSBgYnl0ZXM9JHtzcGxpdFN0YXJ0fS0ke3NwbGl0RW5kfWBcblxuICAgICAgICAgICAgY29uc3QgdXBsb2FkUGFydENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgYnVja2V0TmFtZTogZGVzdE9iakNvbmZpZy5CdWNrZXQsXG4gICAgICAgICAgICAgIG9iamVjdE5hbWU6IGRlc3RPYmpDb25maWcuT2JqZWN0LFxuICAgICAgICAgICAgICB1cGxvYWRJRDogdXBsb2FkSWQsXG4gICAgICAgICAgICAgIHBhcnROdW1iZXI6IHBhcnRJbmRleCxcbiAgICAgICAgICAgICAgaGVhZGVyczogaGVhZGVycyxcbiAgICAgICAgICAgICAgc291cmNlT2JqOiBzb3VyY2VPYmosXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHVwbG9hZFBhcnRDb25maWdMaXN0LnB1c2godXBsb2FkUGFydENvbmZpZylcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9KVxuXG4gICAgICByZXR1cm4gdXBsb2FkUGFydENvbmZpZ0xpc3RcbiAgICB9XG5cbiAgICBjb25zdCB1cGxvYWRBbGxQYXJ0cyA9IGFzeW5jICh1cGxvYWRMaXN0OiBVcGxvYWRQYXJ0Q29uZmlnW10pID0+IHtcbiAgICAgIGNvbnN0IHBhcnRVcGxvYWRzID0gdXBsb2FkTGlzdC5tYXAoYXN5bmMgKGl0ZW0pID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMudXBsb2FkUGFydChpdGVtKVxuICAgICAgfSlcbiAgICAgIC8vIFByb2Nlc3MgcmVzdWx0cyBoZXJlIGlmIG5lZWRlZFxuICAgICAgcmV0dXJuIGF3YWl0IFByb21pc2UuYWxsKHBhcnRVcGxvYWRzKVxuICAgIH1cblxuICAgIGNvbnN0IHBlcmZvcm1VcGxvYWRQYXJ0cyA9IGFzeW5jICh1cGxvYWRJZDogc3RyaW5nKSA9PiB7XG4gICAgICBjb25zdCB1cGxvYWRMaXN0ID0gZ2V0VXBsb2FkUGFydENvbmZpZ0xpc3QodXBsb2FkSWQpXG4gICAgICBjb25zdCBwYXJ0c1JlcyA9IGF3YWl0IHVwbG9hZEFsbFBhcnRzKHVwbG9hZExpc3QpXG4gICAgICByZXR1cm4gcGFydHNSZXMubWFwKChwYXJ0Q29weSkgPT4gKHsgZXRhZzogcGFydENvcHkuZXRhZywgcGFydDogcGFydENvcHkucGFydCB9KSlcbiAgICB9XG5cbiAgICBjb25zdCBuZXdVcGxvYWRIZWFkZXJzID0gZGVzdE9iakNvbmZpZy5nZXRIZWFkZXJzKClcblxuICAgIGNvbnN0IHVwbG9hZElkID0gYXdhaXQgdGhpcy5pbml0aWF0ZU5ld011bHRpcGFydFVwbG9hZChkZXN0T2JqQ29uZmlnLkJ1Y2tldCwgZGVzdE9iakNvbmZpZy5PYmplY3QsIG5ld1VwbG9hZEhlYWRlcnMpXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcnRzRG9uZSA9IGF3YWl0IHBlcmZvcm1VcGxvYWRQYXJ0cyh1cGxvYWRJZClcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkKGRlc3RPYmpDb25maWcuQnVja2V0LCBkZXN0T2JqQ29uZmlnLk9iamVjdCwgdXBsb2FkSWQsIHBhcnRzRG9uZSlcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmFib3J0TXVsdGlwYXJ0VXBsb2FkKGRlc3RPYmpDb25maWcuQnVja2V0LCBkZXN0T2JqQ29uZmlnLk9iamVjdCwgdXBsb2FkSWQpXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcHJlc2lnbmVkVXJsKFxuICAgIG1ldGhvZDogc3RyaW5nLFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgZXhwaXJlcz86IG51bWJlciB8IFByZVNpZ25SZXF1ZXN0UGFyYW1zIHwgdW5kZWZpbmVkLFxuICAgIHJlcVBhcmFtcz86IFByZVNpZ25SZXF1ZXN0UGFyYW1zIHwgRGF0ZSxcbiAgICByZXF1ZXN0RGF0ZT86IERhdGUsXG4gICk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgaWYgKHRoaXMuYW5vbnltb3VzKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkFub255bW91c1JlcXVlc3RFcnJvcihgUHJlc2lnbmVkICR7bWV0aG9kfSB1cmwgY2Fubm90IGJlIGdlbmVyYXRlZCBmb3IgYW5vbnltb3VzIHJlcXVlc3RzYClcbiAgICB9XG5cbiAgICBpZiAoIWV4cGlyZXMpIHtcbiAgICAgIGV4cGlyZXMgPSBQUkVTSUdOX0VYUElSWV9EQVlTX01BWFxuICAgIH1cbiAgICBpZiAoIXJlcVBhcmFtcykge1xuICAgICAgcmVxUGFyYW1zID0ge31cbiAgICB9XG4gICAgaWYgKCFyZXF1ZXN0RGF0ZSkge1xuICAgICAgcmVxdWVzdERhdGUgPSBuZXcgRGF0ZSgpXG4gICAgfVxuXG4gICAgLy8gVHlwZSBhc3NlcnRpb25zXG4gICAgaWYgKGV4cGlyZXMgJiYgdHlwZW9mIGV4cGlyZXMgIT09ICdudW1iZXInKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdleHBpcmVzIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cbiAgICBpZiAocmVxUGFyYW1zICYmIHR5cGVvZiByZXFQYXJhbXMgIT09ICdvYmplY3QnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXFQYXJhbXMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmICgocmVxdWVzdERhdGUgJiYgIShyZXF1ZXN0RGF0ZSBpbnN0YW5jZW9mIERhdGUpKSB8fCAocmVxdWVzdERhdGUgJiYgaXNOYU4ocmVxdWVzdERhdGU/LmdldFRpbWUoKSkpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXF1ZXN0RGF0ZSBzaG91bGQgYmUgb2YgdHlwZSBcIkRhdGVcIiBhbmQgdmFsaWQnKVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5ID0gcmVxUGFyYW1zID8gcXMuc3RyaW5naWZ5KHJlcVBhcmFtcykgOiB1bmRlZmluZWRcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZWdpb24gPSBhd2FpdCB0aGlzLmdldEJ1Y2tldFJlZ2lvbkFzeW5jKGJ1Y2tldE5hbWUpXG4gICAgICBhd2FpdCB0aGlzLmNoZWNrQW5kUmVmcmVzaENyZWRzKClcbiAgICAgIGNvbnN0IHJlcU9wdGlvbnMgPSB0aGlzLmdldFJlcXVlc3RPcHRpb25zKHsgbWV0aG9kLCByZWdpb24sIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0pXG5cbiAgICAgIHJldHVybiBwcmVzaWduU2lnbmF0dXJlVjQoXG4gICAgICAgIHJlcU9wdGlvbnMsXG4gICAgICAgIHRoaXMuYWNjZXNzS2V5LFxuICAgICAgICB0aGlzLnNlY3JldEtleSxcbiAgICAgICAgdGhpcy5zZXNzaW9uVG9rZW4sXG4gICAgICAgIHJlZ2lvbixcbiAgICAgICAgcmVxdWVzdERhdGUsXG4gICAgICAgIGV4cGlyZXMsXG4gICAgICApXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBpZiAoZXJyIGluc3RhbmNlb2YgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgVW5hYmxlIHRvIGdldCBidWNrZXQgcmVnaW9uIGZvciAke2J1Y2tldE5hbWV9LmApXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVyclxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHByZXNpZ25lZEdldE9iamVjdChcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIGV4cGlyZXM/OiBudW1iZXIsXG4gICAgcmVzcEhlYWRlcnM/OiBQcmVTaWduUmVxdWVzdFBhcmFtcyB8IERhdGUsXG4gICAgcmVxdWVzdERhdGU/OiBEYXRlLFxuICApOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgdmFsaWRSZXNwSGVhZGVycyA9IFtcbiAgICAgICdyZXNwb25zZS1jb250ZW50LXR5cGUnLFxuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtbGFuZ3VhZ2UnLFxuICAgICAgJ3Jlc3BvbnNlLWV4cGlyZXMnLFxuICAgICAgJ3Jlc3BvbnNlLWNhY2hlLWNvbnRyb2wnLFxuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtZGlzcG9zaXRpb24nLFxuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtZW5jb2RpbmcnLFxuICAgIF1cbiAgICB2YWxpZFJlc3BIZWFkZXJzLmZvckVhY2goKGhlYWRlcikgPT4ge1xuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgaWYgKHJlc3BIZWFkZXJzICE9PSB1bmRlZmluZWQgJiYgcmVzcEhlYWRlcnNbaGVhZGVyXSAhPT0gdW5kZWZpbmVkICYmICFpc1N0cmluZyhyZXNwSGVhZGVyc1toZWFkZXJdKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGByZXNwb25zZSBoZWFkZXIgJHtoZWFkZXJ9IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCJgKVxuICAgICAgfVxuICAgIH0pXG4gICAgcmV0dXJuIHRoaXMucHJlc2lnbmVkVXJsKCdHRVQnLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBleHBpcmVzLCByZXNwSGVhZGVycywgcmVxdWVzdERhdGUpXG4gIH1cblxuICBhc3luYyBwcmVzaWduZWRQdXRPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGV4cGlyZXM/OiBudW1iZXIpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucHJlc2lnbmVkVXJsKCdQVVQnLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBleHBpcmVzKVxuICB9XG5cbiAgbmV3UG9zdFBvbGljeSgpOiBQb3N0UG9saWN5IHtcbiAgICByZXR1cm4gbmV3IFBvc3RQb2xpY3koKVxuICB9XG5cbiAgYXN5bmMgcHJlc2lnbmVkUG9zdFBvbGljeShwb3N0UG9saWN5OiBQb3N0UG9saWN5KTogUHJvbWlzZTxQb3N0UG9saWN5UmVzdWx0PiB7XG4gICAgaWYgKHRoaXMuYW5vbnltb3VzKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkFub255bW91c1JlcXVlc3RFcnJvcignUHJlc2lnbmVkIFBPU1QgcG9saWN5IGNhbm5vdCBiZSBnZW5lcmF0ZWQgZm9yIGFub255bW91cyByZXF1ZXN0cycpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QocG9zdFBvbGljeSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3Bvc3RQb2xpY3kgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBwb3N0UG9saWN5LmZvcm1EYXRhLmJ1Y2tldCBhcyBzdHJpbmdcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVnaW9uID0gYXdhaXQgdGhpcy5nZXRCdWNrZXRSZWdpb25Bc3luYyhidWNrZXROYW1lKVxuXG4gICAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoKVxuICAgICAgY29uc3QgZGF0ZVN0ciA9IG1ha2VEYXRlTG9uZyhkYXRlKVxuICAgICAgYXdhaXQgdGhpcy5jaGVja0FuZFJlZnJlc2hDcmVkcygpXG5cbiAgICAgIGlmICghcG9zdFBvbGljeS5wb2xpY3kuZXhwaXJhdGlvbikge1xuICAgICAgICAvLyAnZXhwaXJhdGlvbicgaXMgbWFuZGF0b3J5IGZpZWxkIGZvciBTMy5cbiAgICAgICAgLy8gU2V0IGRlZmF1bHQgZXhwaXJhdGlvbiBkYXRlIG9mIDcgZGF5cy5cbiAgICAgICAgY29uc3QgZXhwaXJlcyA9IG5ldyBEYXRlKClcbiAgICAgICAgZXhwaXJlcy5zZXRTZWNvbmRzKFBSRVNJR05fRVhQSVJZX0RBWVNfTUFYKVxuICAgICAgICBwb3N0UG9saWN5LnNldEV4cGlyZXMoZXhwaXJlcylcbiAgICAgIH1cblxuICAgICAgcG9zdFBvbGljeS5wb2xpY3kuY29uZGl0aW9ucy5wdXNoKFsnZXEnLCAnJHgtYW16LWRhdGUnLCBkYXRlU3RyXSlcbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LWRhdGUnXSA9IGRhdGVTdHJcblxuICAgICAgcG9zdFBvbGljeS5wb2xpY3kuY29uZGl0aW9ucy5wdXNoKFsnZXEnLCAnJHgtYW16LWFsZ29yaXRobScsICdBV1M0LUhNQUMtU0hBMjU2J10pXG4gICAgICBwb3N0UG9saWN5LmZvcm1EYXRhWyd4LWFtei1hbGdvcml0aG0nXSA9ICdBV1M0LUhNQUMtU0hBMjU2J1xuXG4gICAgICBwb3N0UG9saWN5LnBvbGljeS5jb25kaXRpb25zLnB1c2goWydlcScsICckeC1hbXotY3JlZGVudGlhbCcsIHRoaXMuYWNjZXNzS2V5ICsgJy8nICsgZ2V0U2NvcGUocmVnaW9uLCBkYXRlKV0pXG4gICAgICBwb3N0UG9saWN5LmZvcm1EYXRhWyd4LWFtei1jcmVkZW50aWFsJ10gPSB0aGlzLmFjY2Vzc0tleSArICcvJyArIGdldFNjb3BlKHJlZ2lvbiwgZGF0ZSlcblxuICAgICAgaWYgKHRoaXMuc2Vzc2lvblRva2VuKSB7XG4gICAgICAgIHBvc3RQb2xpY3kucG9saWN5LmNvbmRpdGlvbnMucHVzaChbJ2VxJywgJyR4LWFtei1zZWN1cml0eS10b2tlbicsIHRoaXMuc2Vzc2lvblRva2VuXSlcbiAgICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotc2VjdXJpdHktdG9rZW4nXSA9IHRoaXMuc2Vzc2lvblRva2VuXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBvbGljeUJhc2U2NCA9IEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KHBvc3RQb2xpY3kucG9saWN5KSkudG9TdHJpbmcoJ2Jhc2U2NCcpXG5cbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGEucG9saWN5ID0gcG9saWN5QmFzZTY0XG5cbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LXNpZ25hdHVyZSddID0gcG9zdFByZXNpZ25TaWduYXR1cmVWNChyZWdpb24sIGRhdGUsIHRoaXMuc2VjcmV0S2V5LCBwb2xpY3lCYXNlNjQpXG4gICAgICBjb25zdCBvcHRzID0ge1xuICAgICAgICByZWdpb246IHJlZ2lvbixcbiAgICAgICAgYnVja2V0TmFtZTogYnVja2V0TmFtZSxcbiAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICB9XG4gICAgICBjb25zdCByZXFPcHRpb25zID0gdGhpcy5nZXRSZXF1ZXN0T3B0aW9ucyhvcHRzKVxuICAgICAgY29uc3QgcG9ydFN0ciA9IHRoaXMucG9ydCA9PSA4MCB8fCB0aGlzLnBvcnQgPT09IDQ0MyA/ICcnIDogYDoke3RoaXMucG9ydC50b1N0cmluZygpfWBcbiAgICAgIGNvbnN0IHVybFN0ciA9IGAke3JlcU9wdGlvbnMucHJvdG9jb2x9Ly8ke3JlcU9wdGlvbnMuaG9zdH0ke3BvcnRTdHJ9JHtyZXFPcHRpb25zLnBhdGh9YFxuICAgICAgcmV0dXJuIHsgcG9zdFVSTDogdXJsU3RyLCBmb3JtRGF0YTogcG9zdFBvbGljeS5mb3JtRGF0YSB9XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBpZiAoZXJyIGluc3RhbmNlb2YgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgVW5hYmxlIHRvIGdldCBidWNrZXQgcmVnaW9uIGZvciAke2J1Y2tldE5hbWV9LmApXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVyclxuICAgIH1cbiAgfVxuICAvLyBsaXN0IGEgYmF0Y2ggb2Ygb2JqZWN0c1xuICBhc3luYyBsaXN0T2JqZWN0c1F1ZXJ5KGJ1Y2tldE5hbWU6IHN0cmluZywgcHJlZml4Pzogc3RyaW5nLCBtYXJrZXI/OiBzdHJpbmcsIGxpc3RRdWVyeU9wdHM/OiBMaXN0T2JqZWN0UXVlcnlPcHRzKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwcmVmaXggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcobWFya2VyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbWFya2VyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cblxuICAgIGlmIChsaXN0UXVlcnlPcHRzICYmICFpc09iamVjdChsaXN0UXVlcnlPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbGlzdFF1ZXJ5T3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgbGV0IHsgRGVsaW1pdGVyLCBNYXhLZXlzLCBJbmNsdWRlVmVyc2lvbiB9ID0gbGlzdFF1ZXJ5T3B0cyBhcyBMaXN0T2JqZWN0UXVlcnlPcHRzXG5cbiAgICBpZiAoIWlzU3RyaW5nKERlbGltaXRlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0RlbGltaXRlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc051bWJlcihNYXhLZXlzKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignTWF4S2V5cyBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICB9XG5cbiAgICBjb25zdCBxdWVyaWVzID0gW11cbiAgICAvLyBlc2NhcGUgZXZlcnkgdmFsdWUgaW4gcXVlcnkgc3RyaW5nLCBleGNlcHQgbWF4S2V5c1xuICAgIHF1ZXJpZXMucHVzaChgcHJlZml4PSR7dXJpRXNjYXBlKHByZWZpeCl9YClcbiAgICBxdWVyaWVzLnB1c2goYGRlbGltaXRlcj0ke3VyaUVzY2FwZShEZWxpbWl0ZXIpfWApXG4gICAgcXVlcmllcy5wdXNoKGBlbmNvZGluZy10eXBlPXVybGApXG5cbiAgICBpZiAoSW5jbHVkZVZlcnNpb24pIHtcbiAgICAgIHF1ZXJpZXMucHVzaChgdmVyc2lvbnNgKVxuICAgIH1cblxuICAgIGlmIChtYXJrZXIpIHtcbiAgICAgIG1hcmtlciA9IHVyaUVzY2FwZShtYXJrZXIpXG4gICAgICBpZiAoSW5jbHVkZVZlcnNpb24pIHtcbiAgICAgICAgcXVlcmllcy5wdXNoKGBrZXktbWFya2VyPSR7bWFya2VyfWApXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBxdWVyaWVzLnB1c2goYG1hcmtlcj0ke21hcmtlcn1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIG5vIG5lZWQgdG8gZXNjYXBlIG1heEtleXNcbiAgICBpZiAoTWF4S2V5cykge1xuICAgICAgaWYgKE1heEtleXMgPj0gMTAwMCkge1xuICAgICAgICBNYXhLZXlzID0gMTAwMFxuICAgICAgfVxuICAgICAgcXVlcmllcy5wdXNoKGBtYXgta2V5cz0ke01heEtleXN9YClcbiAgICB9XG4gICAgcXVlcmllcy5zb3J0KClcbiAgICBsZXQgcXVlcnkgPSAnJ1xuICAgIGlmIChxdWVyaWVzLmxlbmd0aCA+IDApIHtcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcmllcy5qb2luKCcmJyl9YFxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgIGNvbnN0IGxpc3RRcnlMaXN0ID0gcGFyc2VMaXN0T2JqZWN0cyhib2R5KVxuICAgIHJldHVybiBsaXN0UXJ5TGlzdFxuICB9XG5cbiAgbGlzdE9iamVjdHMoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIHByZWZpeD86IHN0cmluZyxcbiAgICByZWN1cnNpdmU/OiBib29sZWFuLFxuICAgIGxpc3RPcHRzPzogTGlzdE9iamVjdFF1ZXJ5T3B0cyB8IHVuZGVmaW5lZCxcbiAgKTogQnVja2V0U3RyZWFtPE9iamVjdEluZm8+IHtcbiAgICBpZiAocHJlZml4ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHByZWZpeCA9ICcnXG4gICAgfVxuICAgIGlmIChyZWN1cnNpdmUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmVjdXJzaXZlID0gZmFsc2VcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkUHJlZml4KHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFByZWZpeEVycm9yKGBJbnZhbGlkIHByZWZpeCA6ICR7cHJlZml4fWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzQm9vbGVhbihyZWN1cnNpdmUpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWN1cnNpdmUgc2hvdWxkIGJlIG9mIHR5cGUgXCJib29sZWFuXCInKVxuICAgIH1cbiAgICBpZiAobGlzdE9wdHMgJiYgIWlzT2JqZWN0KGxpc3RPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbGlzdE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGxldCBtYXJrZXI6IHN0cmluZyB8IHVuZGVmaW5lZCA9ICcnXG4gICAgY29uc3QgbGlzdFF1ZXJ5T3B0cyA9IHtcbiAgICAgIERlbGltaXRlcjogcmVjdXJzaXZlID8gJycgOiAnLycsIC8vIGlmIHJlY3Vyc2l2ZSBpcyBmYWxzZSBzZXQgZGVsaW1pdGVyIHRvICcvJ1xuICAgICAgTWF4S2V5czogMTAwMCxcbiAgICAgIEluY2x1ZGVWZXJzaW9uOiBsaXN0T3B0cz8uSW5jbHVkZVZlcnNpb24sXG4gICAgfVxuICAgIGxldCBvYmplY3RzOiBPYmplY3RJbmZvW10gPSBbXVxuICAgIGxldCBlbmRlZCA9IGZhbHNlXG4gICAgY29uc3QgcmVhZFN0cmVhbTogc3RyZWFtLlJlYWRhYmxlID0gbmV3IHN0cmVhbS5SZWFkYWJsZSh7IG9iamVjdE1vZGU6IHRydWUgfSlcbiAgICByZWFkU3RyZWFtLl9yZWFkID0gYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gcHVzaCBvbmUgb2JqZWN0IHBlciBfcmVhZCgpXG4gICAgICBpZiAob2JqZWN0cy5sZW5ndGgpIHtcbiAgICAgICAgcmVhZFN0cmVhbS5wdXNoKG9iamVjdHMuc2hpZnQoKSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG4gICAgICBpZiAoZW5kZWQpIHtcbiAgICAgICAgcmV0dXJuIHJlYWRTdHJlYW0ucHVzaChudWxsKVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQ6IExpc3RPYmplY3RRdWVyeVJlcyA9IGF3YWl0IHRoaXMubGlzdE9iamVjdHNRdWVyeShidWNrZXROYW1lLCBwcmVmaXgsIG1hcmtlciwgbGlzdFF1ZXJ5T3B0cylcbiAgICAgICAgaWYgKHJlc3VsdC5pc1RydW5jYXRlZCkge1xuICAgICAgICAgIG1hcmtlciA9IHJlc3VsdC5uZXh0TWFya2VyIHx8IHJlc3VsdC52ZXJzaW9uSWRNYXJrZXJcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBlbmRlZCA9IHRydWVcbiAgICAgICAgfVxuICAgICAgICBpZiAocmVzdWx0Lm9iamVjdHMpIHtcbiAgICAgICAgICBvYmplY3RzID0gcmVzdWx0Lm9iamVjdHNcbiAgICAgICAgfVxuICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgIHJlYWRTdHJlYW0uX3JlYWQoKVxuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIHJlYWRTdHJlYW0uZW1pdCgnZXJyb3InLCBlcnIpXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZWFkU3RyZWFtXG4gIH1cbn1cbiJdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxLQUFLQSxNQUFNO0FBQ2xCLE9BQU8sS0FBS0MsRUFBRTtBQUVkLE9BQU8sS0FBS0MsSUFBSTtBQUNoQixPQUFPLEtBQUtDLEtBQUs7QUFDakIsT0FBTyxLQUFLQyxJQUFJO0FBQ2hCLE9BQU8sS0FBS0MsTUFBTTtBQUVsQixPQUFPLEtBQUtDLEtBQUssTUFBTSxPQUFPO0FBQzlCLE9BQU9DLFlBQVksTUFBTSxlQUFlO0FBQ3hDLFNBQVNDLFNBQVMsUUFBUSxpQkFBaUI7QUFDM0MsT0FBT0MsQ0FBQyxNQUFNLFFBQVE7QUFDdEIsT0FBTyxLQUFLQyxFQUFFLE1BQU0sY0FBYztBQUNsQyxPQUFPQyxNQUFNLE1BQU0sUUFBUTtBQUUzQixTQUFTQyxrQkFBa0IsUUFBUSwy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