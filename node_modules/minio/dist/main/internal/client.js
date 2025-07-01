"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var crypto = _interopRequireWildcard(require("crypto"), true);
var fs = _interopRequireWildcard(require("fs"), true);
var http = _interopRequireWildcard(require("http"), true);
var https = _interopRequireWildcard(require("https"), true);
var path = _interopRequireWildcard(require("path"), true);
var stream = _interopRequireWildcard(require("stream"), true);
var async = _interopRequireWildcard(require("async"), true);
var _blockStream = require("block-stream2");
var _browserOrNode = require("browser-or-node");
var _lodash = require("lodash");
var qs = _interopRequireWildcard(require("query-string"), true);
var _xml2js = require("xml2js");
var _CredentialProvider = require("../CredentialProvider.js");
var errors = _interopRequireWildcard(require("../errors.js"), true);
var _helpers = require("../helpers.js");
var _signing = require("../signing.js");
var _async2 = require("./async.js");
var _copyConditions = require("./copy-conditions.js");
var _extensions = require("./extensions.js");
var _helper = require("./helper.js");
var _joinHostPort = require("./join-host-port.js");
var _postPolicy = require("./post-policy.js");
var _request = require("./request.js");
var _response = require("./response.js");
var _s3Endpoints = require("./s3-endpoints.js");
var xmlParsers = _interopRequireWildcard(require("./xml-parser.js"), true);
function _getRequireWildcardCache(nodeInterop) { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap(); var cacheNodeInterop = new WeakMap(); return (_getRequireWildcardCache = function (nodeInterop) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); }
function _interopRequireWildcard(obj, nodeInterop) { if (!nodeInterop && obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }
const xml = new _xml2js.Builder({
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
class TypedClient {
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
    if (!(0, _helper.isValidEndpoint)(params.endPoint)) {
      throw new errors.InvalidEndpointError(`Invalid endPoint : ${params.endPoint}`);
    }
    if (!(0, _helper.isValidPort)(params.port)) {
      throw new errors.InvalidArgumentError(`Invalid port : ${params.port}`);
    }
    if (!(0, _helper.isBoolean)(params.useSSL)) {
      throw new errors.InvalidArgumentError(`Invalid useSSL flag type : ${params.useSSL}, expected to be of type "boolean"`);
    }

    // Validate region only if its set.
    if (params.region) {
      if (!(0, _helper.isString)(params.region)) {
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
      if (!(0, _helper.isObject)(params.transport)) {
        throw new errors.InvalidArgumentError(`Invalid transport type : ${params.transport}, expected to be type "object"`);
      }
      transport = params.transport;
    }

    // if custom transport agent is set, use it.
    if (params.transportAgent) {
      if (!(0, _helper.isObject)(params.transportAgent)) {
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
    this.clientExtensions = new _extensions.Extensions(this);
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
    if (!(0, _helper.isObject)(options)) {
      throw new TypeError('request options should be of type "object"');
    }
    this.reqOptions = _lodash.pick(options, requestOptionProperties);
  }

  /**
   *  This is s3 Specific and does not hold validity in any other Object storage.
   */
  getAccelerateEndPointIfSet(bucketName, objectName) {
    if (!(0, _helper.isEmpty)(this.s3AccelerateEndpoint) && !(0, _helper.isEmpty)(bucketName) && !(0, _helper.isEmpty)(objectName)) {
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
    if (!(0, _helper.isString)(appName)) {
      throw new TypeError(`Invalid appName: ${appName}`);
    }
    if (appName.trim() === '') {
      throw new errors.InvalidArgumentError('Input appName cannot be empty.');
    }
    if (!(0, _helper.isString)(appVersion)) {
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
      virtualHostStyle = (0, _helper.isVirtualHostStyle)(this.host, this.protocol, bucketName, this.pathStyle);
    }
    let path = '/';
    let host = this.host;
    let port;
    if (this.port) {
      port = this.port;
    }
    if (objectName) {
      objectName = (0, _helper.uriResourceEscape)(objectName);
    }

    // For Amazon S3 endpoint, get endpoint based on region.
    if ((0, _helper.isAmazonEndpoint)(host)) {
      const accelerateEndPoint = this.getAccelerateEndPointIfSet(bucketName, objectName);
      if (accelerateEndPoint) {
        host = `${accelerateEndPoint}`;
      } else {
        host = (0, _s3Endpoints.getS3Endpoint)(region);
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
      reqOptions.headers.host = (0, _joinHostPort.joinHostPort)(host, port);
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
      headers: _lodash.mapValues(_lodash.pickBy(reqOptions.headers, _helper.isDefined), v => v.toString()),
      host,
      port,
      path
    };
  }
  async setCredentialsProvider(credentialsProvider) {
    if (!(credentialsProvider instanceof _CredentialProvider.CredentialProvider)) {
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
    if (!(0, _helper.isObject)(reqOptions)) {
      throw new TypeError('reqOptions should be of type "object"');
    }
    if (response && !(0, _helper.isReadableStream)(response)) {
      throw new TypeError('response should be of type "Stream"');
    }
    if (err && !(err instanceof Error)) {
      throw new TypeError('err should be of type "Error"');
    }
    const logStream = this.logStream;
    const logHeaders = headers => {
      Object.entries(headers).forEach(([k, v]) => {
        if (k == 'authorization') {
          if ((0, _helper.isString)(v)) {
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
    if (!(0, _helper.isObject)(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!(0, _helper.isString)(payload) && !(0, _helper.isObject)(payload)) {
      // Buffer is of type 'object'
      throw new TypeError('payload should be of type "string" or "Buffer"');
    }
    expectedCodes.forEach(statusCode => {
      if (!(0, _helper.isNumber)(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!(0, _helper.isString)(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (!options.headers) {
      options.headers = {};
    }
    if (options.method === 'POST' || options.method === 'PUT' || options.method === 'DELETE') {
      options.headers['content-length'] = payload.length.toString();
    }
    const sha256sum = this.enableSHA256 ? (0, _helper.toSha256)(payload) : '';
    return this.makeRequestStreamAsync(options, payload, sha256sum, expectedCodes, region);
  }

  /**
   * new request with promise
   *
   * No need to drain response, response body is not valid
   */
  async makeRequestAsyncOmit(options, payload = '', statusCodes = [200], region = '') {
    const res = await this.makeRequestAsync(options, payload, statusCodes, region);
    await (0, _response.drainResponse)(res);
    return res;
  }

  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @internal
   */
  async makeRequestStreamAsync(options, body, sha256sum, statusCodes, region) {
    if (!(0, _helper.isObject)(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!(Buffer.isBuffer(body) || typeof body === 'string' || (0, _helper.isReadableStream)(body))) {
      throw new errors.InvalidArgumentError(`stream should be a Buffer, string or readable Stream, got ${typeof body} instead`);
    }
    if (!(0, _helper.isString)(sha256sum)) {
      throw new TypeError('sha256sum should be of type "string"');
    }
    statusCodes.forEach(statusCode => {
      if (!(0, _helper.isNumber)(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!(0, _helper.isString)(region)) {
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
      reqOptions.headers['x-amz-date'] = (0, _helper.makeDateLong)(date);
      reqOptions.headers['x-amz-content-sha256'] = sha256sum;
      if (this.sessionToken) {
        reqOptions.headers['x-amz-security-token'] = this.sessionToken;
      }
      reqOptions.headers.authorization = (0, _signing.signV4)(reqOptions, this.accessKey, this.secretKey, region, date, sha256sum);
    }
    const response = await (0, _request.requestWithRetry)(this.transport, reqOptions, body);
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
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
      const body = await (0, _response.readAsString)(response);
      const region = xmlParsers.parseBucketRegion(body) || _helpers.DEFAULT_REGION;
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
    const pathStyle = this.pathStyle && !_browserOrNode.isBrowser;
    let region;
    try {
      const res = await this.makeRequestAsync({
        method,
        bucketName,
        query,
        pathStyle
      }, '', [200], _helpers.DEFAULT_REGION);
      return extractRegionAsync(res);
    } catch (e) {
      // make alignment with mc cli
      if (e instanceof errors.S3Error) {
        const errCode = e.code;
        const errRegion = e.region;
        if (errCode === 'AccessDenied' && !errRegion) {
          return _helpers.DEFAULT_REGION;
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
        await (0, _response.drainResponse)(res);
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    // Backward Compatibility
    if ((0, _helper.isObject)(region)) {
      makeOpts = region;
      region = '';
    }
    if (!(0, _helper.isString)(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (makeOpts && !(0, _helper.isObject)(makeOpts)) {
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
    if (region && region !== _helpers.DEFAULT_REGION) {
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
    const finalRegion = this.region || region || _helpers.DEFAULT_REGION;
    const requestOpt = {
      method,
      bucketName,
      headers
    };
    try {
      await this.makeRequestAsyncOmit(requestOpt, payload, [200], finalRegion);
    } catch (err) {
      if (region === '' || region === _helpers.DEFAULT_REGION) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isNumber)(offset)) {
      throw new TypeError('offset should be of type "number"');
    }
    if (!(0, _helper.isNumber)(length)) {
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
        ...(0, _helper.prependXAMZMeta)(sseHeaders),
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    const downloadToTmpFile = async () => {
      let partFileStream;
      const objStat = await this.statObject(bucketName, objectName, getOpts);
      const encodedEtag = Buffer.from(objStat.etag).toString('base64');
      const partFile = `${filePath}.${encodedEtag}.part.minio`;
      await _async2.fsp.mkdir(path.dirname(filePath), {
        recursive: true
      });
      let offset = 0;
      try {
        const stats = await _async2.fsp.stat(partFile);
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
      await _async2.streamPromise.pipeline(downloadStream, partFileStream);
      const stats = await _async2.fsp.stat(partFile);
      if (stats.size === objStat.size) {
        return partFile;
      }
      throw new Error('Size mismatch between downloaded file and the object');
    };
    const partFile = await downloadToTmpFile();
    await _async2.fsp.rename(partFile, filePath);
  }

  /**
   * Stat information of the object.
   */
  async statObject(bucketName, objectName, statOpts) {
    const statOptDef = statOpts || {};
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(statOptDef)) {
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
      metaData: (0, _helper.extractMetadata)(res.headers),
      lastModified: new Date(res.headers['last-modified']),
      versionId: (0, _helper.getVersionId)(res.headers),
      etag: (0, _helper.sanitizeETag)(res.headers.etag)
    };
  }
  async removeObject(bucketName, objectName, removeOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (removeOpts && !(0, _helper.isObject)(removeOpts)) {
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
    if (!(0, _helper.isValidBucketName)(bucket)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucket);
    }
    if (!(0, _helper.isValidPrefix)(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!(0, _helper.isBoolean)(recursive)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isString)(keyMarker)) {
      throw new TypeError('keyMarker should be of type "string"');
    }
    if (!(0, _helper.isString)(uploadIdMarker)) {
      throw new TypeError('uploadIdMarker should be of type "string"');
    }
    if (!(0, _helper.isString)(delimiter)) {
      throw new TypeError('delimiter should be of type "string"');
    }
    const queries = [];
    queries.push(`prefix=${(0, _helper.uriEscape)(prefix)}`);
    queries.push(`delimiter=${(0, _helper.uriEscape)(delimiter)}`);
    if (keyMarker) {
      queries.push(`key-marker=${(0, _helper.uriEscape)(keyMarker)}`);
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
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseListMultipart(body);
  }

  /**
   * Initiate a new multipart upload.
   * @internal
   */
  async initiateNewMultipartUpload(bucketName, objectName, headers) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(headers)) {
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
    const body = await (0, _response.readAsBuffer)(res);
    return (0, xmlParsers.parseInitiateMultipart)(body.toString());
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!(0, _helper.isObject)(etags)) {
      throw new TypeError('etags should be of type "Array"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    const method = 'POST';
    const query = `uploadId=${(0, _helper.uriEscape)(uploadId)}`;
    const builder = new _xml2js.Builder();
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
    const body = await (0, _response.readAsBuffer)(res);
    const result = (0, xmlParsers.parseCompleteMultipart)(body.toString());
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
      versionId: (0, _helper.getVersionId)(res.headers)
    };
  }

  /**
   * Get part-info of all parts of an incomplete upload specified by uploadId.
   */
  async listParts(bucketName, objectName, uploadId) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(uploadId)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!(0, _helper.isNumber)(marker)) {
      throw new TypeError('marker should be of type "number"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    let query = `uploadId=${(0, _helper.uriEscape)(uploadId)}`;
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
    return xmlParsers.parseListParts(await (0, _response.readAsString)(res));
  }
  async listBuckets() {
    const method = 'GET';
    const regionConf = this.region || _helpers.DEFAULT_REGION;
    const httpRes = await this.makeRequestAsync({
      method
    }, '', [200], regionConf);
    const xmlResult = await (0, _response.readAsString)(httpRes);
    return xmlParsers.parseListBucket(xmlResult);
  }

  /**
   * Calculate part size given the object size. Part size will be atleast this.partSize
   */
  calculatePartSize(size) {
    if (!(0, _helper.isNumber)(size)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    if (metaData && !(0, _helper.isObject)(metaData)) {
      throw new TypeError('metaData should be of type "object"');
    }

    // Inserts correct `content-type` attribute based on metaData and filePath
    metaData = (0, _helper.insertContentType)(metaData || {}, filePath);
    const stat = await _async2.fsp.lstat(filePath);
    return await this.putObject(bucketName, objectName, fs.createReadStream(filePath), stat.size, metaData);
  }

  /**
   *  Uploading a stream, "Buffer" or "string".
   *  It's recommended to pass `size` argument with stream.
   */
  async putObject(bucketName, objectName, stream, size, metaData) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }

    // We'll need to shift arguments to the left because of metaData
    // and size being optional.
    if ((0, _helper.isObject)(size)) {
      metaData = size;
    }
    // Ensures Metadata has appropriate prefix for A3 API
    const headers = (0, _helper.prependXAMZMeta)(metaData);
    if (typeof stream === 'string' || stream instanceof Buffer) {
      // Adapts the non-stream interface into a stream.
      size = stream.length;
      stream = (0, _helper.readableStream)(stream);
    } else if (!(0, _helper.isReadableStream)(stream)) {
      throw new TypeError('third argument should be of type "stream.Readable" or "Buffer" or "string"');
    }
    if ((0, _helper.isNumber)(size) && size < 0) {
      throw new errors.InvalidArgumentError(`size cannot be negative, given size: ${size}`);
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (!(0, _helper.isNumber)(size)) {
      size = this.maxObjectSize;
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (size === undefined) {
      const statSize = await (0, _helper.getContentLength)(stream);
      if (statSize !== null) {
        size = statSize;
      }
    }
    if (!(0, _helper.isNumber)(size)) {
      // Backward compatibility
      size = this.maxObjectSize;
    }
    const partSize = this.calculatePartSize(size);
    if (typeof stream === 'string' || stream.readableLength === 0 || Buffer.isBuffer(stream) || size <= partSize) {
      const buf = (0, _helper.isReadableStream)(stream) ? await (0, _response.readAsBuffer)(stream) : Buffer.from(stream);
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
    } = (0, _helper.hashBinary)(buf, this.enableSHA256);
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
    await (0, _response.drainResponse)(res);
    return {
      etag: (0, _helper.sanitizeETag)(res.headers.etag),
      versionId: (0, _helper.getVersionId)(res.headers)
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
    const chunkier = new _blockStream({
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isObject)(replicationConfig)) {
      throw new errors.InvalidArgumentError('replicationConfig should be of type "object"');
    } else {
      if (_lodash.isEmpty(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Role cannot be empty');
      } else if (replicationConfig.role && !(0, _helper.isString)(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Invalid value for role', replicationConfig.role);
      }
      if (_lodash.isEmpty(replicationConfig.rules)) {
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
    const builder = new _xml2js.Builder({
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(replicationParamsConfig);
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketReplication(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'replication';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    }, '', [200, 204]);
    const xmlResult = await (0, _response.readAsString)(httpRes);
    return xmlParsers.parseReplicationConfig(xmlResult);
  }
  async getObjectLegalHold(bucketName, objectName, getOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (getOpts) {
      if (!(0, _helper.isObject)(getOpts)) {
        throw new TypeError('getOpts should be of type "Object"');
      } else if (Object.keys(getOpts).length > 0 && getOpts.versionId && !(0, _helper.isString)(getOpts.versionId)) {
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
    const strRes = await (0, _response.readAsString)(httpRes);
    return (0, xmlParsers.parseObjectLegalHoldConfig)(strRes);
  }
  async setObjectLegalHold(bucketName, objectName, setOpts = {
    status: _helpers.LEGAL_HOLD_STATUS.ENABLED
  }) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(setOpts)) {
      throw new TypeError('setOpts should be of type "Object"');
    } else {
      if (![_helpers.LEGAL_HOLD_STATUS.ENABLED, _helpers.LEGAL_HOLD_STATUS.DISABLED].includes(setOpts === null || setOpts === void 0 ? void 0 : setOpts.status)) {
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
    const builder = new _xml2js.Builder({
      rootName: 'LegalHold',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
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
    const body = await (0, _response.readAsString)(response);
    return xmlParsers.parseTagging(body);
  }

  /**
   *  Get the tags associated with a bucket OR an object
   */
  async getObjectTagging(bucketName, objectName, getOpts) {
    const method = 'GET';
    let query = 'tagging';
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (getOpts && !(0, _helper.isObject)(getOpts)) {
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
    const body = await (0, _response.readAsString)(response);
    return xmlParsers.parseTagging(body);
  }

  /**
   *  Set the policy on a bucket or an object prefix.
   */
  async setBucketPolicy(bucketName, policy) {
    // Validate arguments.
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isString)(policy)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    const method = 'GET';
    const query = 'policy';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    return await (0, _response.readAsString)(res);
  }
  async putObjectRetention(bucketName, objectName, retentionOpts = {}) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(retentionOpts)) {
      throw new errors.InvalidArgumentError('retentionOpts should be of type "object"');
    } else {
      if (retentionOpts.governanceBypass && !(0, _helper.isBoolean)(retentionOpts.governanceBypass)) {
        throw new errors.InvalidArgumentError(`Invalid value for governanceBypass: ${retentionOpts.governanceBypass}`);
      }
      if (retentionOpts.mode && ![_helpers.RETENTION_MODES.COMPLIANCE, _helpers.RETENTION_MODES.GOVERNANCE].includes(retentionOpts.mode)) {
        throw new errors.InvalidArgumentError(`Invalid object retention mode: ${retentionOpts.mode}`);
      }
      if (retentionOpts.retainUntilDate && !(0, _helper.isString)(retentionOpts.retainUntilDate)) {
        throw new errors.InvalidArgumentError(`Invalid value for retainUntilDate: ${retentionOpts.retainUntilDate}`);
      }
      if (retentionOpts.versionId && !(0, _helper.isString)(retentionOpts.versionId)) {
        throw new errors.InvalidArgumentError(`Invalid value for versionId: ${retentionOpts.versionId}`);
      }
    }
    const method = 'PUT';
    let query = 'retention';
    const headers = {};
    if (retentionOpts.governanceBypass) {
      headers['X-Amz-Bypass-Governance-Retention'] = true;
    }
    const builder = new _xml2js.Builder({
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
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query,
      headers
    }, payload, [200, 204]);
  }
  async getObjectLockConfig(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'object-lock';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const xmlResult = await (0, _response.readAsString)(httpRes);
    return xmlParsers.parseObjectLockConfig(xmlResult);
  }
  async setObjectLockConfig(bucketName, lockConfigOpts) {
    const retentionModes = [_helpers.RETENTION_MODES.COMPLIANCE, _helpers.RETENTION_MODES.GOVERNANCE];
    const validUnits = [_helpers.RETENTION_VALIDITY_UNITS.DAYS, _helpers.RETENTION_VALIDITY_UNITS.YEARS];
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (lockConfigOpts.mode && !retentionModes.includes(lockConfigOpts.mode)) {
      throw new TypeError(`lockConfigOpts.mode should be one of ${retentionModes}`);
    }
    if (lockConfigOpts.unit && !validUnits.includes(lockConfigOpts.unit)) {
      throw new TypeError(`lockConfigOpts.unit should be one of ${validUnits}`);
    }
    if (lockConfigOpts.validity && !(0, _helper.isNumber)(lockConfigOpts.validity)) {
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
        if (lockConfigOpts.unit === _helpers.RETENTION_VALIDITY_UNITS.DAYS) {
          config.Rule.DefaultRetention.Days = lockConfigOpts.validity;
        } else if (lockConfigOpts.unit === _helpers.RETENTION_VALIDITY_UNITS.YEARS) {
          config.Rule.DefaultRetention.Years = lockConfigOpts.validity;
        }
      }
    }
    const builder = new _xml2js.Builder({
      rootName: 'ObjectLockConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketVersioning(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'versioning';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const xmlResult = await (0, _response.readAsString)(httpRes);
    return await xmlParsers.parseBucketVersioningConfig(xmlResult);
  }
  async setBucketVersioning(bucketName, versionConfig) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Object.keys(versionConfig).length) {
      throw new errors.InvalidArgumentError('versionConfig should be of type "object"');
    }
    const method = 'PUT';
    const query = 'versioning';
    const builder = new _xml2js.Builder({
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
    const builder = new _xml2js.Builder({
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
    headers['Content-MD5'] = (0, _helper.toMd5)(payloadBuf);
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isObject)(tags)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    await this.removeTagging({
      bucketName
    });
  }
  async setObjectTagging(bucketName, objectName, tags, putOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (!(0, _helper.isObject)(tags)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (removeOpts && Object.keys(removeOpts).length && !(0, _helper.isObject)(removeOpts)) {
      throw new errors.InvalidArgumentError('removeOpts should be of type "object"');
    }
    await this.removeTagging({
      bucketName,
      objectName,
      removeOpts
    });
  }
  async selectObjectContent(bucketName, objectName, selectOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!_lodash.isEmpty(selectOpts)) {
      if (!(0, _helper.isString)(selectOpts.expression)) {
        throw new TypeError('sqlExpression should be of type "string"');
      }
      if (!_lodash.isEmpty(selectOpts.inputSerialization)) {
        if (!(0, _helper.isObject)(selectOpts.inputSerialization)) {
          throw new TypeError('inputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('inputSerialization is required');
      }
      if (!_lodash.isEmpty(selectOpts.outputSerialization)) {
        if (!(0, _helper.isObject)(selectOpts.outputSerialization)) {
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
    const builder = new _xml2js.Builder({
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
    const body = await (0, _response.readAsBuffer)(res);
    return (0, xmlParsers.parseSelectObjectContentResponse)(body);
  }
  async applyBucketLifecycle(bucketName, policyConfig) {
    const method = 'PUT';
    const query = 'lifecycle';
    const headers = {};
    const builder = new _xml2js.Builder({
      rootName: 'LifecycleConfiguration',
      headless: true,
      renderOpts: {
        pretty: false
      }
    });
    const payload = builder.buildObject(policyConfig);
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async removeBucketLifecycle(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (_lodash.isEmpty(lifeCycleConfig)) {
      await this.removeBucketLifecycle(bucketName);
    } else {
      await this.applyBucketLifecycle(bucketName, lifeCycleConfig);
    }
  }
  async getBucketLifecycle(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'lifecycle';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseLifecycleConfig(body);
  }
  async setBucketEncryption(bucketName, encryptionConfig) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!_lodash.isEmpty(encryptionConfig) && encryptionConfig.Rule.length > 1) {
      throw new errors.InvalidArgumentError('Invalid Rule length. Only one rule is allowed.: ' + encryptionConfig.Rule);
    }
    let encryptionObj = encryptionConfig;
    if (_lodash.isEmpty(encryptionConfig)) {
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
    const builder = new _xml2js.Builder({
      rootName: 'ServerSideEncryptionConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(encryptionObj);
    const headers = {};
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketEncryption(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'encryption';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseBucketEncryptionConfig(body);
  }
  async removeBucketEncryption(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (getOpts && !(0, _helper.isObject)(getOpts)) {
      throw new errors.InvalidArgumentError('getOpts should be of type "object"');
    } else if (getOpts !== null && getOpts !== void 0 && getOpts.versionId && !(0, _helper.isString)(getOpts.versionId)) {
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
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseObjectRetentionConfig(body);
  }
  async removeObjects(bucketName, objectsList) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Array.isArray(objectsList)) {
      throw new errors.InvalidArgumentError('objectsList should be a list');
    }
    const runDeleteObjects = async batch => {
      const delObjects = batch.map(value => {
        return (0, _helper.isObject)(value) ? {
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
      const payload = Buffer.from(new _xml2js.Builder({
        headless: true
      }).buildObject(remObjects));
      const headers = {
        'Content-MD5': (0, _helper.toMd5)(payload)
      };
      const res = await this.makeRequestAsync({
        method: 'POST',
        bucketName,
        query: 'delete',
        headers
      }, payload);
      const body = await (0, _response.readAsString)(res);
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.IsValidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
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
    if (!(0, _helper.isValidBucketName)(targetBucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + targetBucketName);
    }
    if (!(0, _helper.isValidObjectName)(targetObjectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${targetObjectName}`);
    }
    if (!(0, _helper.isString)(sourceBucketNameAndObjectName)) {
      throw new TypeError('sourceBucketNameAndObjectName should be of type "string"');
    }
    if (sourceBucketNameAndObjectName === '') {
      throw new errors.InvalidPrefixError(`Empty source prefix`);
    }
    if (conditions != null && !(conditions instanceof _copyConditions.CopyConditions)) {
      throw new TypeError('conditions should be of type "CopyConditions"');
    }
    const headers = {};
    headers['x-amz-copy-source'] = (0, _helper.uriResourceEscape)(sourceBucketNameAndObjectName);
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
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseCopyObject(body);
  }
  async copyObjectV2(sourceConfig, destConfig) {
    if (!(sourceConfig instanceof _helpers.CopySourceOptions)) {
      throw new errors.InvalidArgumentError('sourceConfig should of type CopySourceOptions ');
    }
    if (!(destConfig instanceof _helpers.CopyDestinationOptions)) {
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
    const body = await (0, _response.readAsString)(res);
    const copyRes = xmlParsers.parseCopyObject(body);
    const resHeaders = res.headers;
    const sizeHeaderValue = resHeaders && resHeaders['content-length'];
    const size = typeof sizeHeaderValue === 'number' ? sizeHeaderValue : undefined;
    return {
      Bucket: destConfig.Bucket,
      Key: destConfig.Object,
      LastModified: copyRes.lastModified,
      MetaData: (0, _helper.extractMetadata)(resHeaders),
      VersionId: (0, _helper.getVersionId)(resHeaders),
      SourceVersionId: (0, _helper.getSourceVersionId)(resHeaders),
      Etag: (0, _helper.sanitizeETag)(resHeaders.etag),
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
    const body = await (0, _response.readAsString)(res);
    const partRes = (0, xmlParsers.uploadPartParser)(body);
    return {
      etag: (0, _helper.sanitizeETag)(partRes.ETag),
      key: objectName,
      part: partNumber
    };
  }
  async composeObject(destObjConfig, sourceObjList) {
    const sourceFilesLength = sourceObjList.length;
    if (!Array.isArray(sourceObjList)) {
      throw new errors.InvalidArgumentError('sourceConfig should an array of CopySourceOptions ');
    }
    if (!(destObjConfig instanceof _helpers.CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (sourceFilesLength < 1 || sourceFilesLength > _helper.PART_CONSTRAINTS.MAX_PARTS_COUNT) {
      throw new errors.InvalidArgumentError(`"There must be as least one and up to ${_helper.PART_CONSTRAINTS.MAX_PARTS_COUNT} source objects.`);
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
      if (!_lodash.isEmpty(srcConfig.VersionID)) {
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
      if (srcCopySize < _helper.PART_CONSTRAINTS.ABS_MIN_PART_SIZE && index < sourceFilesLength - 1) {
        throw new errors.InvalidArgumentError(`CopySrcOptions ${index} is too small (${srcCopySize}) and it is not the last part.`);
      }

      // Is data to copy too large?
      totalSize += srcCopySize;
      if (totalSize > _helper.PART_CONSTRAINTS.MAX_MULTIPART_PUT_OBJECT_SIZE) {
        throw new errors.InvalidArgumentError(`Cannot compose an object of size ${totalSize} (> 5TiB)`);
      }

      // record source size
      srcObjectSizes[index] = srcCopySize;

      // calculate parts needed for current source
      totalParts += (0, _helper.partsRequired)(srcCopySize);
      // Do we need more parts than we are allowed?
      if (totalParts > _helper.PART_CONSTRAINTS.MAX_PARTS_COUNT) {
        throw new errors.InvalidArgumentError(`Your proposed compose object requires more than ${_helper.PART_CONSTRAINTS.MAX_PARTS_COUNT} parts`);
      }
      return resItemStat;
    });
    if (totalParts === 1 && totalSize <= _helper.PART_CONSTRAINTS.MAX_PART_SIZE || totalSize === 0) {
      return await this.copyObject(sourceObjList[0], destObjConfig); // use copyObjectV2
    }

    // preserve etag to avoid modification of object while copying.
    for (let i = 0; i < sourceFilesLength; i++) {
      ;
      sourceObjList[i].MatchETag = validatedStats[i].etag;
    }
    const splitPartSizeList = validatedStats.map((resItemStat, idx) => {
      return (0, _helper.calculateEvenSplits)(srcObjectSizes[idx], sourceObjList[idx]);
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
      expires = _helpers.PRESIGN_EXPIRY_DAYS_MAX;
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
      return (0, _signing.presignSignatureV4)(reqOptions, this.accessKey, this.secretKey, this.sessionToken, region, requestDate, expires);
    } catch (err) {
      if (err instanceof errors.InvalidBucketNameError) {
        throw new errors.InvalidArgumentError(`Unable to get bucket region for ${bucketName}.`);
      }
      throw err;
    }
  }
  async presignedGetObject(bucketName, objectName, expires, respHeaders, requestDate) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    const validRespHeaders = ['response-content-type', 'response-content-language', 'response-expires', 'response-cache-control', 'response-content-disposition', 'response-content-encoding'];
    validRespHeaders.forEach(header => {
      // @ts-ignore
      if (respHeaders !== undefined && respHeaders[header] !== undefined && !(0, _helper.isString)(respHeaders[header])) {
        throw new TypeError(`response header ${header} should be of type "string"`);
      }
    });
    return this.presignedUrl('GET', bucketName, objectName, expires, respHeaders, requestDate);
  }
  async presignedPutObject(bucketName, objectName, expires) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    return this.presignedUrl('PUT', bucketName, objectName, expires);
  }
  newPostPolicy() {
    return new _postPolicy.PostPolicy();
  }
  async presignedPostPolicy(postPolicy) {
    if (this.anonymous) {
      throw new errors.AnonymousRequestError('Presigned POST policy cannot be generated for anonymous requests');
    }
    if (!(0, _helper.isObject)(postPolicy)) {
      throw new TypeError('postPolicy should be of type "object"');
    }
    const bucketName = postPolicy.formData.bucket;
    try {
      const region = await this.getBucketRegionAsync(bucketName);
      const date = new Date();
      const dateStr = (0, _helper.makeDateLong)(date);
      await this.checkAndRefreshCreds();
      if (!postPolicy.policy.expiration) {
        // 'expiration' is mandatory field for S3.
        // Set default expiration date of 7 days.
        const expires = new Date();
        expires.setSeconds(_helpers.PRESIGN_EXPIRY_DAYS_MAX);
        postPolicy.setExpires(expires);
      }
      postPolicy.policy.conditions.push(['eq', '$x-amz-date', dateStr]);
      postPolicy.formData['x-amz-date'] = dateStr;
      postPolicy.policy.conditions.push(['eq', '$x-amz-algorithm', 'AWS4-HMAC-SHA256']);
      postPolicy.formData['x-amz-algorithm'] = 'AWS4-HMAC-SHA256';
      postPolicy.policy.conditions.push(['eq', '$x-amz-credential', this.accessKey + '/' + (0, _helper.getScope)(region, date)]);
      postPolicy.formData['x-amz-credential'] = this.accessKey + '/' + (0, _helper.getScope)(region, date);
      if (this.sessionToken) {
        postPolicy.policy.conditions.push(['eq', '$x-amz-security-token', this.sessionToken]);
        postPolicy.formData['x-amz-security-token'] = this.sessionToken;
      }
      const policyBase64 = Buffer.from(JSON.stringify(postPolicy.policy)).toString('base64');
      postPolicy.formData.policy = policyBase64;
      postPolicy.formData['x-amz-signature'] = (0, _signing.postPresignSignatureV4)(region, date, this.secretKey, policyBase64);
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
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isString)(marker)) {
      throw new TypeError('marker should be of type "string"');
    }
    if (listQueryOpts && !(0, _helper.isObject)(listQueryOpts)) {
      throw new TypeError('listQueryOpts should be of type "object"');
    }
    let {
      Delimiter,
      MaxKeys,
      IncludeVersion
    } = listQueryOpts;
    if (!(0, _helper.isString)(Delimiter)) {
      throw new TypeError('Delimiter should be of type "string"');
    }
    if (!(0, _helper.isNumber)(MaxKeys)) {
      throw new TypeError('MaxKeys should be of type "number"');
    }
    const queries = [];
    // escape every value in query string, except maxKeys
    queries.push(`prefix=${(0, _helper.uriEscape)(prefix)}`);
    queries.push(`delimiter=${(0, _helper.uriEscape)(Delimiter)}`);
    queries.push(`encoding-type=url`);
    if (IncludeVersion) {
      queries.push(`versions`);
    }
    if (marker) {
      marker = (0, _helper.uriEscape)(marker);
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
    const body = await (0, _response.readAsString)(res);
    const listQryList = (0, xmlParsers.parseListObjects)(body);
    return listQryList;
  }
  listObjects(bucketName, prefix, recursive, listOpts) {
    if (prefix === undefined) {
      prefix = '';
    }
    if (recursive === undefined) {
      recursive = false;
    }
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidPrefix)(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isBoolean)(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    if (listOpts && !(0, _helper.isObject)(listOpts)) {
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
exports.TypedClient = TypedClient;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcnlwdG8iLCJfaW50ZXJvcFJlcXVpcmVXaWxkY2FyZCIsInJlcXVpcmUiLCJmcyIsImh0dHAiLCJodHRwcyIsInBhdGgiLCJzdHJlYW0iLCJhc3luYyIsIl9ibG9ja1N0cmVhbSIsIl9icm93c2VyT3JOb2RlIiwiX2xvZGFzaCIsInFzIiwiX3htbDJqcyIsIl9DcmVkZW50aWFsUHJvdmlkZXIiLCJlcnJvcnMiLCJfaGVscGVycyIsIl9zaWduaW5nIiwiX2FzeW5jMiIsIl9jb3B5Q29uZGl0aW9ucyIsIl9leHRlbnNpb25zIiwiX2hlbHBlciIsIl9qb2luSG9zdFBvcnQiLCJfcG9zdFBvbGljeSIsIl9yZXF1ZXN0IiwiX3Jlc3BvbnNlIiwiX3MzRW5kcG9pbnRzIiwieG1sUGFyc2VycyIsIl9nZXRSZXF1aXJlV2lsZGNhcmRDYWNoZSIsIm5vZGVJbnRlcm9wIiwiV2Vha01hcCIsImNhY2hlQmFiZWxJbnRlcm9wIiwiY2FjaGVOb2RlSW50ZXJvcCIsIm9iaiIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiY2FjaGUiLCJoYXMiLCJnZXQiLCJuZXdPYmoiLCJoYXNQcm9wZXJ0eURlc2NyaXB0b3IiLCJPYmplY3QiLCJkZWZpbmVQcm9wZXJ0eSIsImdldE93blByb3BlcnR5RGVzY3JpcHRvciIsImtleSIsInByb3RvdHlwZSIsImhhc093blByb3BlcnR5IiwiY2FsbCIsImRlc2MiLCJzZXQiLCJ4bWwiLCJ4bWwyanMiLCJCdWlsZGVyIiwicmVuZGVyT3B0cyIsInByZXR0eSIsImhlYWRsZXNzIiwiUGFja2FnZSIsInZlcnNpb24iLCJyZXF1ZXN0T3B0aW9uUHJvcGVydGllcyIsIlR5cGVkQ2xpZW50IiwicGFydFNpemUiLCJtYXhpbXVtUGFydFNpemUiLCJtYXhPYmplY3RTaXplIiwiY29uc3RydWN0b3IiLCJwYXJhbXMiLCJzZWN1cmUiLCJ1bmRlZmluZWQiLCJFcnJvciIsInVzZVNTTCIsInBvcnQiLCJpc1ZhbGlkRW5kcG9pbnQiLCJlbmRQb2ludCIsIkludmFsaWRFbmRwb2ludEVycm9yIiwiaXNWYWxpZFBvcnQiLCJJbnZhbGlkQXJndW1lbnRFcnJvciIsImlzQm9vbGVhbiIsInJlZ2lvbiIsImlzU3RyaW5nIiwiaG9zdCIsInRvTG93ZXJDYXNlIiwicHJvdG9jb2wiLCJ0cmFuc3BvcnQiLCJ0cmFuc3BvcnRBZ2VudCIsImdsb2JhbEFnZW50IiwiaXNPYmplY3QiLCJsaWJyYXJ5Q29tbWVudHMiLCJwcm9jZXNzIiwicGxhdGZvcm0iLCJhcmNoIiwibGlicmFyeUFnZW50IiwidXNlckFnZW50IiwicGF0aFN0eWxlIiwiYWNjZXNzS2V5Iiwic2VjcmV0S2V5Iiwic2Vzc2lvblRva2VuIiwiYW5vbnltb3VzIiwiY3JlZGVudGlhbHNQcm92aWRlciIsInJlZ2lvbk1hcCIsIm92ZXJSaWRlUGFydFNpemUiLCJlbmFibGVTSEEyNTYiLCJzM0FjY2VsZXJhdGVFbmRwb2ludCIsInJlcU9wdGlvbnMiLCJjbGllbnRFeHRlbnNpb25zIiwiRXh0ZW5zaW9ucyIsImV4dGVuc2lvbnMiLCJzZXRTM1RyYW5zZmVyQWNjZWxlcmF0ZSIsInNldFJlcXVlc3RPcHRpb25zIiwib3B0aW9ucyIsIlR5cGVFcnJvciIsIl8iLCJwaWNrIiwiZ2V0QWNjZWxlcmF0ZUVuZFBvaW50SWZTZXQiLCJidWNrZXROYW1lIiwib2JqZWN0TmFtZSIsImlzRW1wdHkiLCJpbmNsdWRlcyIsInNldEFwcEluZm8iLCJhcHBOYW1lIiwiYXBwVmVyc2lvbiIsInRyaW0iLCJnZXRSZXF1ZXN0T3B0aW9ucyIsIm9wdHMiLCJtZXRob2QiLCJoZWFkZXJzIiwicXVlcnkiLCJhZ2VudCIsInZpcnR1YWxIb3N0U3R5bGUiLCJpc1ZpcnR1YWxIb3N0U3R5bGUiLCJ1cmlSZXNvdXJjZUVzY2FwZSIsImlzQW1hem9uRW5kcG9pbnQiLCJhY2NlbGVyYXRlRW5kUG9pbnQiLCJnZXRTM0VuZHBvaW50Iiwiam9pbkhvc3RQb3J0IiwiayIsInYiLCJlbnRyaWVzIiwiYXNzaWduIiwibWFwVmFsdWVzIiwicGlja0J5IiwiaXNEZWZpbmVkIiwidG9TdHJpbmciLCJzZXRDcmVkZW50aWFsc1Byb3ZpZGVyIiwiQ3JlZGVudGlhbFByb3ZpZGVyIiwiY2hlY2tBbmRSZWZyZXNoQ3JlZHMiLCJjcmVkZW50aWFsc0NvbmYiLCJnZXRDcmVkZW50aWFscyIsImdldEFjY2Vzc0tleSIsImdldFNlY3JldEtleSIsImdldFNlc3Npb25Ub2tlbiIsImUiLCJjYXVzZSIsImxvZ0hUVFAiLCJyZXNwb25zZSIsImVyciIsImxvZ1N0cmVhbSIsImlzUmVhZGFibGVTdHJlYW0iLCJsb2dIZWFkZXJzIiwiZm9yRWFjaCIsInJlZGFjdG9yIiwiUmVnRXhwIiwicmVwbGFjZSIsIndyaXRlIiwic3RhdHVzQ29kZSIsImVyckpTT04iLCJKU09OIiwic3RyaW5naWZ5IiwidHJhY2VPbiIsInN0ZG91dCIsInRyYWNlT2ZmIiwibWFrZVJlcXVlc3RBc3luYyIsInBheWxvYWQiLCJleHBlY3RlZENvZGVzIiwiaXNOdW1iZXIiLCJsZW5ndGgiLCJzaGEyNTZzdW0iLCJ0b1NoYTI1NiIsIm1ha2VSZXF1ZXN0U3RyZWFtQXN5bmMiLCJtYWtlUmVxdWVzdEFzeW5jT21pdCIsInN0YXR1c0NvZGVzIiwicmVzIiwiZHJhaW5SZXNwb25zZSIsImJvZHkiLCJCdWZmZXIiLCJpc0J1ZmZlciIsImdldEJ1Y2tldFJlZ2lvbkFzeW5jIiwiZGF0ZSIsIkRhdGUiLCJtYWtlRGF0ZUxvbmciLCJhdXRob3JpemF0aW9uIiwic2lnblY0IiwicmVxdWVzdFdpdGhSZXRyeSIsInBhcnNlUmVzcG9uc2VFcnJvciIsImlzVmFsaWRCdWNrZXROYW1lIiwiSW52YWxpZEJ1Y2tldE5hbWVFcnJvciIsImNhY2hlZCIsImV4dHJhY3RSZWdpb25Bc3luYyIsInJlYWRBc1N0cmluZyIsInBhcnNlQnVja2V0UmVnaW9uIiwiREVGQVVMVF9SRUdJT04iLCJpc0Jyb3dzZXIiLCJTM0Vycm9yIiwiZXJyQ29kZSIsImNvZGUiLCJlcnJSZWdpb24iLCJuYW1lIiwiUmVnaW9uIiwibWFrZVJlcXVlc3QiLCJyZXR1cm5SZXNwb25zZSIsImNiIiwicHJvbSIsInRoZW4iLCJyZXN1bHQiLCJtYWtlUmVxdWVzdFN0cmVhbSIsImV4ZWN1dG9yIiwiZ2V0QnVja2V0UmVnaW9uIiwibWFrZUJ1Y2tldCIsIm1ha2VPcHRzIiwiYnVpbGRPYmplY3QiLCJDcmVhdGVCdWNrZXRDb25maWd1cmF0aW9uIiwiJCIsInhtbG5zIiwiTG9jYXRpb25Db25zdHJhaW50IiwiT2JqZWN0TG9ja2luZyIsImZpbmFsUmVnaW9uIiwicmVxdWVzdE9wdCIsImJ1Y2tldEV4aXN0cyIsInJlbW92ZUJ1Y2tldCIsImdldE9iamVjdCIsImdldE9wdHMiLCJpc1ZhbGlkT2JqZWN0TmFtZSIsIkludmFsaWRPYmplY3ROYW1lRXJyb3IiLCJnZXRQYXJ0aWFsT2JqZWN0Iiwib2Zmc2V0IiwicmFuZ2UiLCJzc2VIZWFkZXJzIiwiU1NFQ3VzdG9tZXJBbGdvcml0aG0iLCJTU0VDdXN0b21lcktleSIsIlNTRUN1c3RvbWVyS2V5TUQ1IiwicHJlcGVuZFhBTVpNZXRhIiwiZXhwZWN0ZWRTdGF0dXNDb2RlcyIsInB1c2giLCJmR2V0T2JqZWN0IiwiZmlsZVBhdGgiLCJkb3dubG9hZFRvVG1wRmlsZSIsInBhcnRGaWxlU3RyZWFtIiwib2JqU3RhdCIsInN0YXRPYmplY3QiLCJlbmNvZGVkRXRhZyIsImZyb20iLCJldGFnIiwicGFydEZpbGUiLCJmc3AiLCJta2RpciIsImRpcm5hbWUiLCJyZWN1cnNpdmUiLCJzdGF0cyIsInN0YXQiLCJzaXplIiwiY3JlYXRlV3JpdGVTdHJlYW0iLCJmbGFncyIsImRvd25sb2FkU3RyZWFtIiwic3RyZWFtUHJvbWlzZSIsInBpcGVsaW5lIiwicmVuYW1lIiwic3RhdE9wdHMiLCJzdGF0T3B0RGVmIiwicGFyc2VJbnQiLCJtZXRhRGF0YSIsImV4dHJhY3RNZXRhZGF0YSIsImxhc3RNb2RpZmllZCIsInZlcnNpb25JZCIsImdldFZlcnNpb25JZCIsInNhbml0aXplRVRhZyIsInJlbW92ZU9iamVjdCIsInJlbW92ZU9wdHMiLCJnb3Zlcm5hbmNlQnlwYXNzIiwiZm9yY2VEZWxldGUiLCJxdWVyeVBhcmFtcyIsImxpc3RJbmNvbXBsZXRlVXBsb2FkcyIsImJ1Y2tldCIsInByZWZpeCIsImlzVmFsaWRQcmVmaXgiLCJJbnZhbGlkUHJlZml4RXJyb3IiLCJkZWxpbWl0ZXIiLCJrZXlNYXJrZXIiLCJ1cGxvYWRJZE1hcmtlciIsInVwbG9hZHMiLCJlbmRlZCIsInJlYWRTdHJlYW0iLCJSZWFkYWJsZSIsIm9iamVjdE1vZGUiLCJfcmVhZCIsInNoaWZ0IiwibGlzdEluY29tcGxldGVVcGxvYWRzUXVlcnkiLCJwcmVmaXhlcyIsImVhY2hTZXJpZXMiLCJ1cGxvYWQiLCJsaXN0UGFydHMiLCJ1cGxvYWRJZCIsInBhcnRzIiwicmVkdWNlIiwiYWNjIiwiaXRlbSIsImVtaXQiLCJpc1RydW5jYXRlZCIsIm5leHRLZXlNYXJrZXIiLCJuZXh0VXBsb2FkSWRNYXJrZXIiLCJxdWVyaWVzIiwidXJpRXNjYXBlIiwibWF4VXBsb2FkcyIsInNvcnQiLCJ1bnNoaWZ0Iiwiam9pbiIsInBhcnNlTGlzdE11bHRpcGFydCIsImluaXRpYXRlTmV3TXVsdGlwYXJ0VXBsb2FkIiwicmVhZEFzQnVmZmVyIiwicGFyc2VJbml0aWF0ZU11bHRpcGFydCIsImFib3J0TXVsdGlwYXJ0VXBsb2FkIiwicmVxdWVzdE9wdGlvbnMiLCJmaW5kVXBsb2FkSWQiLCJfbGF0ZXN0VXBsb2FkIiwibGF0ZXN0VXBsb2FkIiwiaW5pdGlhdGVkIiwiZ2V0VGltZSIsImNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkIiwiZXRhZ3MiLCJidWlsZGVyIiwiQ29tcGxldGVNdWx0aXBhcnRVcGxvYWQiLCJQYXJ0IiwibWFwIiwiUGFydE51bWJlciIsInBhcnQiLCJFVGFnIiwicGFyc2VDb21wbGV0ZU11bHRpcGFydCIsImVyck1lc3NhZ2UiLCJtYXJrZXIiLCJsaXN0UGFydHNRdWVyeSIsInBhcnNlTGlzdFBhcnRzIiwibGlzdEJ1Y2tldHMiLCJyZWdpb25Db25mIiwiaHR0cFJlcyIsInhtbFJlc3VsdCIsInBhcnNlTGlzdEJ1Y2tldCIsImNhbGN1bGF0ZVBhcnRTaXplIiwiZlB1dE9iamVjdCIsImluc2VydENvbnRlbnRUeXBlIiwibHN0YXQiLCJwdXRPYmplY3QiLCJjcmVhdGVSZWFkU3RyZWFtIiwicmVhZGFibGVTdHJlYW0iLCJzdGF0U2l6ZSIsImdldENvbnRlbnRMZW5ndGgiLCJyZWFkYWJsZUxlbmd0aCIsImJ1ZiIsInVwbG9hZEJ1ZmZlciIsInVwbG9hZFN0cmVhbSIsIm1kNXN1bSIsImhhc2hCaW5hcnkiLCJvbGRQYXJ0cyIsImVUYWdzIiwicHJldmlvdXNVcGxvYWRJZCIsIm9sZFRhZ3MiLCJjaHVua2llciIsIkJsb2NrU3RyZWFtMiIsInplcm9QYWRkaW5nIiwibyIsIlByb21pc2UiLCJhbGwiLCJyZXNvbHZlIiwicmVqZWN0IiwicGlwZSIsIm9uIiwicGFydE51bWJlciIsImNodW5rIiwibWQ1IiwiY3JlYXRlSGFzaCIsInVwZGF0ZSIsImRpZ2VzdCIsIm9sZFBhcnQiLCJyZW1vdmVCdWNrZXRSZXBsaWNhdGlvbiIsInNldEJ1Y2tldFJlcGxpY2F0aW9uIiwicmVwbGljYXRpb25Db25maWciLCJyb2xlIiwicnVsZXMiLCJyZXBsaWNhdGlvblBhcmFtc0NvbmZpZyIsIlJlcGxpY2F0aW9uQ29uZmlndXJhdGlvbiIsIlJvbGUiLCJSdWxlIiwidG9NZDUiLCJnZXRCdWNrZXRSZXBsaWNhdGlvbiIsInBhcnNlUmVwbGljYXRpb25Db25maWciLCJnZXRPYmplY3RMZWdhbEhvbGQiLCJrZXlzIiwic3RyUmVzIiwicGFyc2VPYmplY3RMZWdhbEhvbGRDb25maWciLCJzZXRPYmplY3RMZWdhbEhvbGQiLCJzZXRPcHRzIiwic3RhdHVzIiwiTEVHQUxfSE9MRF9TVEFUVVMiLCJFTkFCTEVEIiwiRElTQUJMRUQiLCJjb25maWciLCJTdGF0dXMiLCJyb290TmFtZSIsImdldEJ1Y2tldFRhZ2dpbmciLCJwYXJzZVRhZ2dpbmciLCJnZXRPYmplY3RUYWdnaW5nIiwic2V0QnVja2V0UG9saWN5IiwicG9saWN5IiwiSW52YWxpZEJ1Y2tldFBvbGljeUVycm9yIiwiZ2V0QnVja2V0UG9saWN5IiwicHV0T2JqZWN0UmV0ZW50aW9uIiwicmV0ZW50aW9uT3B0cyIsIm1vZGUiLCJSRVRFTlRJT05fTU9ERVMiLCJDT01QTElBTkNFIiwiR09WRVJOQU5DRSIsInJldGFpblVudGlsRGF0ZSIsIk1vZGUiLCJSZXRhaW5VbnRpbERhdGUiLCJnZXRPYmplY3RMb2NrQ29uZmlnIiwicGFyc2VPYmplY3RMb2NrQ29uZmlnIiwic2V0T2JqZWN0TG9ja0NvbmZpZyIsImxvY2tDb25maWdPcHRzIiwicmV0ZW50aW9uTW9kZXMiLCJ2YWxpZFVuaXRzIiwiUkVURU5USU9OX1ZBTElESVRZX1VOSVRTIiwiREFZUyIsIllFQVJTIiwidW5pdCIsInZhbGlkaXR5IiwiT2JqZWN0TG9ja0VuYWJsZWQiLCJjb25maWdLZXlzIiwiaXNBbGxLZXlzU2V0IiwiZXZlcnkiLCJsY2siLCJEZWZhdWx0UmV0ZW50aW9uIiwiRGF5cyIsIlllYXJzIiwiZ2V0QnVja2V0VmVyc2lvbmluZyIsInBhcnNlQnVja2V0VmVyc2lvbmluZ0NvbmZpZyIsInNldEJ1Y2tldFZlcnNpb25pbmciLCJ2ZXJzaW9uQ29uZmlnIiwic2V0VGFnZ2luZyIsInRhZ2dpbmdQYXJhbXMiLCJ0YWdzIiwicHV0T3B0cyIsInRhZ3NMaXN0IiwidmFsdWUiLCJLZXkiLCJWYWx1ZSIsInRhZ2dpbmdDb25maWciLCJUYWdnaW5nIiwiVGFnU2V0IiwiVGFnIiwicGF5bG9hZEJ1ZiIsInJlbW92ZVRhZ2dpbmciLCJzZXRCdWNrZXRUYWdnaW5nIiwicmVtb3ZlQnVja2V0VGFnZ2luZyIsInNldE9iamVjdFRhZ2dpbmciLCJyZW1vdmVPYmplY3RUYWdnaW5nIiwic2VsZWN0T2JqZWN0Q29udGVudCIsInNlbGVjdE9wdHMiLCJleHByZXNzaW9uIiwiaW5wdXRTZXJpYWxpemF0aW9uIiwib3V0cHV0U2VyaWFsaXphdGlvbiIsIkV4cHJlc3Npb24iLCJFeHByZXNzaW9uVHlwZSIsImV4cHJlc3Npb25UeXBlIiwiSW5wdXRTZXJpYWxpemF0aW9uIiwiT3V0cHV0U2VyaWFsaXphdGlvbiIsInJlcXVlc3RQcm9ncmVzcyIsIlJlcXVlc3RQcm9ncmVzcyIsInNjYW5SYW5nZSIsIlNjYW5SYW5nZSIsInBhcnNlU2VsZWN0T2JqZWN0Q29udGVudFJlc3BvbnNlIiwiYXBwbHlCdWNrZXRMaWZlY3ljbGUiLCJwb2xpY3lDb25maWciLCJyZW1vdmVCdWNrZXRMaWZlY3ljbGUiLCJzZXRCdWNrZXRMaWZlY3ljbGUiLCJsaWZlQ3ljbGVDb25maWciLCJnZXRCdWNrZXRMaWZlY3ljbGUiLCJwYXJzZUxpZmVjeWNsZUNvbmZpZyIsInNldEJ1Y2tldEVuY3J5cHRpb24iLCJlbmNyeXB0aW9uQ29uZmlnIiwiZW5jcnlwdGlvbk9iaiIsIkFwcGx5U2VydmVyU2lkZUVuY3J5cHRpb25CeURlZmF1bHQiLCJTU0VBbGdvcml0aG0iLCJnZXRCdWNrZXRFbmNyeXB0aW9uIiwicGFyc2VCdWNrZXRFbmNyeXB0aW9uQ29uZmlnIiwicmVtb3ZlQnVja2V0RW5jcnlwdGlvbiIsImdldE9iamVjdFJldGVudGlvbiIsInBhcnNlT2JqZWN0UmV0ZW50aW9uQ29uZmlnIiwicmVtb3ZlT2JqZWN0cyIsIm9iamVjdHNMaXN0IiwiQXJyYXkiLCJpc0FycmF5IiwicnVuRGVsZXRlT2JqZWN0cyIsImJhdGNoIiwiZGVsT2JqZWN0cyIsIlZlcnNpb25JZCIsInJlbU9iamVjdHMiLCJEZWxldGUiLCJRdWlldCIsInJlbW92ZU9iamVjdHNQYXJzZXIiLCJtYXhFbnRyaWVzIiwiYmF0Y2hlcyIsImkiLCJzbGljZSIsImJhdGNoUmVzdWx0cyIsImZsYXQiLCJyZW1vdmVJbmNvbXBsZXRlVXBsb2FkIiwiSXNWYWxpZEJ1Y2tldE5hbWVFcnJvciIsInJlbW92ZVVwbG9hZElkIiwiY29weU9iamVjdFYxIiwidGFyZ2V0QnVja2V0TmFtZSIsInRhcmdldE9iamVjdE5hbWUiLCJzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSIsImNvbmRpdGlvbnMiLCJDb3B5Q29uZGl0aW9ucyIsIm1vZGlmaWVkIiwidW5tb2RpZmllZCIsIm1hdGNoRVRhZyIsIm1hdGNoRVRhZ0V4Y2VwdCIsInBhcnNlQ29weU9iamVjdCIsImNvcHlPYmplY3RWMiIsInNvdXJjZUNvbmZpZyIsImRlc3RDb25maWciLCJDb3B5U291cmNlT3B0aW9ucyIsIkNvcHlEZXN0aW5hdGlvbk9wdGlvbnMiLCJ2YWxpZGF0ZSIsImdldEhlYWRlcnMiLCJCdWNrZXQiLCJjb3B5UmVzIiwicmVzSGVhZGVycyIsInNpemVIZWFkZXJWYWx1ZSIsIkxhc3RNb2RpZmllZCIsIk1ldGFEYXRhIiwiU291cmNlVmVyc2lvbklkIiwiZ2V0U291cmNlVmVyc2lvbklkIiwiRXRhZyIsIlNpemUiLCJjb3B5T2JqZWN0IiwiYWxsQXJncyIsInNvdXJjZSIsImRlc3QiLCJ1cGxvYWRQYXJ0IiwicGFydENvbmZpZyIsInVwbG9hZElEIiwicGFydFJlcyIsInVwbG9hZFBhcnRQYXJzZXIiLCJjb21wb3NlT2JqZWN0IiwiZGVzdE9iakNvbmZpZyIsInNvdXJjZU9iakxpc3QiLCJzb3VyY2VGaWxlc0xlbmd0aCIsIlBBUlRfQ09OU1RSQUlOVFMiLCJNQVhfUEFSVFNfQ09VTlQiLCJzT2JqIiwiZ2V0U3RhdE9wdGlvbnMiLCJzcmNDb25maWciLCJWZXJzaW9uSUQiLCJzcmNPYmplY3RTaXplcyIsInRvdGFsU2l6ZSIsInRvdGFsUGFydHMiLCJzb3VyY2VPYmpTdGF0cyIsInNyY0l0ZW0iLCJzcmNPYmplY3RJbmZvcyIsInZhbGlkYXRlZFN0YXRzIiwicmVzSXRlbVN0YXQiLCJpbmRleCIsInNyY0NvcHlTaXplIiwiTWF0Y2hSYW5nZSIsInNyY1N0YXJ0IiwiU3RhcnQiLCJzcmNFbmQiLCJFbmQiLCJBQlNfTUlOX1BBUlRfU0laRSIsIk1BWF9NVUxUSVBBUlRfUFVUX09CSkVDVF9TSVpFIiwicGFydHNSZXF1aXJlZCIsIk1BWF9QQVJUX1NJWkUiLCJNYXRjaEVUYWciLCJzcGxpdFBhcnRTaXplTGlzdCIsImlkeCIsImNhbGN1bGF0ZUV2ZW5TcGxpdHMiLCJnZXRVcGxvYWRQYXJ0Q29uZmlnTGlzdCIsInVwbG9hZFBhcnRDb25maWdMaXN0Iiwic3BsaXRTaXplIiwic3BsaXRJbmRleCIsInN0YXJ0SW5kZXgiLCJzdGFydElkeCIsImVuZEluZGV4IiwiZW5kSWR4Iiwib2JqSW5mbyIsIm9iakNvbmZpZyIsInBhcnRJbmRleCIsInRvdGFsVXBsb2FkcyIsInNwbGl0U3RhcnQiLCJ1cGxkQ3RySWR4Iiwic3BsaXRFbmQiLCJzb3VyY2VPYmoiLCJ1cGxvYWRQYXJ0Q29uZmlnIiwidXBsb2FkQWxsUGFydHMiLCJ1cGxvYWRMaXN0IiwicGFydFVwbG9hZHMiLCJwZXJmb3JtVXBsb2FkUGFydHMiLCJwYXJ0c1JlcyIsInBhcnRDb3B5IiwibmV3VXBsb2FkSGVhZGVycyIsInBhcnRzRG9uZSIsInByZXNpZ25lZFVybCIsImV4cGlyZXMiLCJyZXFQYXJhbXMiLCJyZXF1ZXN0RGF0ZSIsIl9yZXF1ZXN0RGF0ZSIsIkFub255bW91c1JlcXVlc3RFcnJvciIsIlBSRVNJR05fRVhQSVJZX0RBWVNfTUFYIiwiaXNOYU4iLCJwcmVzaWduU2lnbmF0dXJlVjQiLCJwcmVzaWduZWRHZXRPYmplY3QiLCJyZXNwSGVhZGVycyIsInZhbGlkUmVzcEhlYWRlcnMiLCJoZWFkZXIiLCJwcmVzaWduZWRQdXRPYmplY3QiLCJuZXdQb3N0UG9saWN5IiwiUG9zdFBvbGljeSIsInByZXNpZ25lZFBvc3RQb2xpY3kiLCJwb3N0UG9saWN5IiwiZm9ybURhdGEiLCJkYXRlU3RyIiwiZXhwaXJhdGlvbiIsInNldFNlY29uZHMiLCJzZXRFeHBpcmVzIiwiZ2V0U2NvcGUiLCJwb2xpY3lCYXNlNjQiLCJwb3N0UHJlc2lnblNpZ25hdHVyZVY0IiwicG9ydFN0ciIsInVybFN0ciIsInBvc3RVUkwiLCJsaXN0T2JqZWN0c1F1ZXJ5IiwibGlzdFF1ZXJ5T3B0cyIsIkRlbGltaXRlciIsIk1heEtleXMiLCJJbmNsdWRlVmVyc2lvbiIsImxpc3RRcnlMaXN0IiwicGFyc2VMaXN0T2JqZWN0cyIsImxpc3RPYmplY3RzIiwibGlzdE9wdHMiLCJvYmplY3RzIiwibmV4dE1hcmtlciIsInZlcnNpb25JZE1hcmtlciIsImV4cG9ydHMiXSwic291cmNlcyI6WyJjbGllbnQudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY3J5cHRvIGZyb20gJ25vZGU6Y3J5cHRvJ1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcydcbmltcG9ydCB0eXBlIHsgSW5jb21pbmdIdHRwSGVhZGVycyB9IGZyb20gJ25vZGU6aHR0cCdcbmltcG9ydCAqIGFzIGh0dHAgZnJvbSAnbm9kZTpodHRwJ1xuaW1wb3J0ICogYXMgaHR0cHMgZnJvbSAnbm9kZTpodHRwcydcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAnbm9kZTpwYXRoJ1xuaW1wb3J0ICogYXMgc3RyZWFtIGZyb20gJ25vZGU6c3RyZWFtJ1xuXG5pbXBvcnQgKiBhcyBhc3luYyBmcm9tICdhc3luYydcbmltcG9ydCBCbG9ja1N0cmVhbTIgZnJvbSAnYmxvY2stc3RyZWFtMidcbmltcG9ydCB7IGlzQnJvd3NlciB9IGZyb20gJ2Jyb3dzZXItb3Itbm9kZSdcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCdcbmltcG9ydCAqIGFzIHFzIGZyb20gJ3F1ZXJ5LXN0cmluZydcbmltcG9ydCB4bWwyanMgZnJvbSAneG1sMmpzJ1xuXG5pbXBvcnQgeyBDcmVkZW50aWFsUHJvdmlkZXIgfSBmcm9tICcuLi9DcmVkZW50aWFsUHJvdmlkZXIudHMnXG5pbXBvcnQgKiBhcyBlcnJvcnMgZnJvbSAnLi4vZXJyb3JzLnRzJ1xuaW1wb3J0IHR5cGUgeyBTZWxlY3RSZXN1bHRzIH0gZnJvbSAnLi4vaGVscGVycy50cydcbmltcG9ydCB7XG4gIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMsXG4gIENvcHlTb3VyY2VPcHRpb25zLFxuICBERUZBVUxUX1JFR0lPTixcbiAgTEVHQUxfSE9MRF9TVEFUVVMsXG4gIFBSRVNJR05fRVhQSVJZX0RBWVNfTUFYLFxuICBSRVRFTlRJT05fTU9ERVMsXG4gIFJFVEVOVElPTl9WQUxJRElUWV9VTklUUyxcbn0gZnJvbSAnLi4vaGVscGVycy50cydcbmltcG9ydCB0eXBlIHsgUG9zdFBvbGljeVJlc3VsdCB9IGZyb20gJy4uL21pbmlvLnRzJ1xuaW1wb3J0IHsgcG9zdFByZXNpZ25TaWduYXR1cmVWNCwgcHJlc2lnblNpZ25hdHVyZVY0LCBzaWduVjQgfSBmcm9tICcuLi9zaWduaW5nLnRzJ1xuaW1wb3J0IHsgZnNwLCBzdHJlYW1Qcm9taXNlIH0gZnJvbSAnLi9hc3luYy50cydcbmltcG9ydCB7IENvcHlDb25kaXRpb25zIH0gZnJvbSAnLi9jb3B5LWNvbmRpdGlvbnMudHMnXG5pbXBvcnQgeyBFeHRlbnNpb25zIH0gZnJvbSAnLi9leHRlbnNpb25zLnRzJ1xuaW1wb3J0IHtcbiAgY2FsY3VsYXRlRXZlblNwbGl0cyxcbiAgZXh0cmFjdE1ldGFkYXRhLFxuICBnZXRDb250ZW50TGVuZ3RoLFxuICBnZXRTY29wZSxcbiAgZ2V0U291cmNlVmVyc2lvbklkLFxuICBnZXRWZXJzaW9uSWQsXG4gIGhhc2hCaW5hcnksXG4gIGluc2VydENvbnRlbnRUeXBlLFxuICBpc0FtYXpvbkVuZHBvaW50LFxuICBpc0Jvb2xlYW4sXG4gIGlzRGVmaW5lZCxcbiAgaXNFbXB0eSxcbiAgaXNOdW1iZXIsXG4gIGlzT2JqZWN0LFxuICBpc1JlYWRhYmxlU3RyZWFtLFxuICBpc1N0cmluZyxcbiAgaXNWYWxpZEJ1Y2tldE5hbWUsXG4gIGlzVmFsaWRFbmRwb2ludCxcbiAgaXNWYWxpZE9iamVjdE5hbWUsXG4gIGlzVmFsaWRQb3J0LFxuICBpc1ZhbGlkUHJlZml4LFxuICBpc1ZpcnR1YWxIb3N0U3R5bGUsXG4gIG1ha2VEYXRlTG9uZyxcbiAgUEFSVF9DT05TVFJBSU5UUyxcbiAgcGFydHNSZXF1aXJlZCxcbiAgcHJlcGVuZFhBTVpNZXRhLFxuICByZWFkYWJsZVN0cmVhbSxcbiAgc2FuaXRpemVFVGFnLFxuICB0b01kNSxcbiAgdG9TaGEyNTYsXG4gIHVyaUVzY2FwZSxcbiAgdXJpUmVzb3VyY2VFc2NhcGUsXG59IGZyb20gJy4vaGVscGVyLnRzJ1xuaW1wb3J0IHsgam9pbkhvc3RQb3J0IH0gZnJvbSAnLi9qb2luLWhvc3QtcG9ydC50cydcbmltcG9ydCB7IFBvc3RQb2xpY3kgfSBmcm9tICcuL3Bvc3QtcG9saWN5LnRzJ1xuaW1wb3J0IHsgcmVxdWVzdFdpdGhSZXRyeSB9IGZyb20gJy4vcmVxdWVzdC50cydcbmltcG9ydCB7IGRyYWluUmVzcG9uc2UsIHJlYWRBc0J1ZmZlciwgcmVhZEFzU3RyaW5nIH0gZnJvbSAnLi9yZXNwb25zZS50cydcbmltcG9ydCB0eXBlIHsgUmVnaW9uIH0gZnJvbSAnLi9zMy1lbmRwb2ludHMudHMnXG5pbXBvcnQgeyBnZXRTM0VuZHBvaW50IH0gZnJvbSAnLi9zMy1lbmRwb2ludHMudHMnXG5pbXBvcnQgdHlwZSB7XG4gIEJpbmFyeSxcbiAgQnVja2V0SXRlbUZyb21MaXN0LFxuICBCdWNrZXRJdGVtU3RhdCxcbiAgQnVja2V0U3RyZWFtLFxuICBCdWNrZXRWZXJzaW9uaW5nQ29uZmlndXJhdGlvbixcbiAgQ29weU9iamVjdFBhcmFtcyxcbiAgQ29weU9iamVjdFJlc3VsdCxcbiAgQ29weU9iamVjdFJlc3VsdFYyLFxuICBFbmNyeXB0aW9uQ29uZmlnLFxuICBHZXRPYmplY3RMZWdhbEhvbGRPcHRpb25zLFxuICBHZXRPYmplY3RPcHRzLFxuICBHZXRPYmplY3RSZXRlbnRpb25PcHRzLFxuICBJbmNvbXBsZXRlVXBsb2FkZWRCdWNrZXRJdGVtLFxuICBJUmVxdWVzdCxcbiAgSXRlbUJ1Y2tldE1ldGFkYXRhLFxuICBMaWZlY3ljbGVDb25maWcsXG4gIExpZmVDeWNsZUNvbmZpZ1BhcmFtLFxuICBMaXN0T2JqZWN0UXVlcnlPcHRzLFxuICBMaXN0T2JqZWN0UXVlcnlSZXMsXG4gIE9iamVjdEluZm8sXG4gIE9iamVjdExvY2tDb25maWdQYXJhbSxcbiAgT2JqZWN0TG9ja0luZm8sXG4gIE9iamVjdE1ldGFEYXRhLFxuICBPYmplY3RSZXRlbnRpb25JbmZvLFxuICBQcmVTaWduUmVxdWVzdFBhcmFtcyxcbiAgUHV0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyxcbiAgUHV0VGFnZ2luZ1BhcmFtcyxcbiAgUmVtb3ZlT2JqZWN0c1BhcmFtLFxuICBSZW1vdmVPYmplY3RzUmVxdWVzdEVudHJ5LFxuICBSZW1vdmVPYmplY3RzUmVzcG9uc2UsXG4gIFJlbW92ZVRhZ2dpbmdQYXJhbXMsXG4gIFJlcGxpY2F0aW9uQ29uZmlnLFxuICBSZXBsaWNhdGlvbkNvbmZpZ09wdHMsXG4gIFJlcXVlc3RIZWFkZXJzLFxuICBSZXNwb25zZUhlYWRlcixcbiAgUmVzdWx0Q2FsbGJhY2ssXG4gIFJldGVudGlvbixcbiAgU2VsZWN0T3B0aW9ucyxcbiAgU3RhdE9iamVjdE9wdHMsXG4gIFRhZyxcbiAgVGFnZ2luZ09wdHMsXG4gIFRhZ3MsXG4gIFRyYW5zcG9ydCxcbiAgVXBsb2FkZWRPYmplY3RJbmZvLFxuICBVcGxvYWRQYXJ0Q29uZmlnLFxufSBmcm9tICcuL3R5cGUudHMnXG5pbXBvcnQgdHlwZSB7IExpc3RNdWx0aXBhcnRSZXN1bHQsIFVwbG9hZGVkUGFydCB9IGZyb20gJy4veG1sLXBhcnNlci50cydcbmltcG9ydCB7XG4gIHBhcnNlQ29tcGxldGVNdWx0aXBhcnQsXG4gIHBhcnNlSW5pdGlhdGVNdWx0aXBhcnQsXG4gIHBhcnNlTGlzdE9iamVjdHMsXG4gIHBhcnNlT2JqZWN0TGVnYWxIb2xkQ29uZmlnLFxuICBwYXJzZVNlbGVjdE9iamVjdENvbnRlbnRSZXNwb25zZSxcbiAgdXBsb2FkUGFydFBhcnNlcixcbn0gZnJvbSAnLi94bWwtcGFyc2VyLnRzJ1xuaW1wb3J0ICogYXMgeG1sUGFyc2VycyBmcm9tICcuL3htbC1wYXJzZXIudHMnXG5cbmNvbnN0IHhtbCA9IG5ldyB4bWwyanMuQnVpbGRlcih7IHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LCBoZWFkbGVzczogdHJ1ZSB9KVxuXG4vLyB3aWxsIGJlIHJlcGxhY2VkIGJ5IGJ1bmRsZXIuXG5jb25zdCBQYWNrYWdlID0geyB2ZXJzaW9uOiBwcm9jZXNzLmVudi5NSU5JT19KU19QQUNLQUdFX1ZFUlNJT04gfHwgJ2RldmVsb3BtZW50JyB9XG5cbmNvbnN0IHJlcXVlc3RPcHRpb25Qcm9wZXJ0aWVzID0gW1xuICAnYWdlbnQnLFxuICAnY2EnLFxuICAnY2VydCcsXG4gICdjaXBoZXJzJyxcbiAgJ2NsaWVudENlcnRFbmdpbmUnLFxuICAnY3JsJyxcbiAgJ2RocGFyYW0nLFxuICAnZWNkaEN1cnZlJyxcbiAgJ2ZhbWlseScsXG4gICdob25vckNpcGhlck9yZGVyJyxcbiAgJ2tleScsXG4gICdwYXNzcGhyYXNlJyxcbiAgJ3BmeCcsXG4gICdyZWplY3RVbmF1dGhvcml6ZWQnLFxuICAnc2VjdXJlT3B0aW9ucycsXG4gICdzZWN1cmVQcm90b2NvbCcsXG4gICdzZXJ2ZXJuYW1lJyxcbiAgJ3Nlc3Npb25JZENvbnRleHQnLFxuXSBhcyBjb25zdFxuXG5leHBvcnQgaW50ZXJmYWNlIENsaWVudE9wdGlvbnMge1xuICBlbmRQb2ludDogc3RyaW5nXG4gIGFjY2Vzc0tleT86IHN0cmluZ1xuICBzZWNyZXRLZXk/OiBzdHJpbmdcbiAgdXNlU1NMPzogYm9vbGVhblxuICBwb3J0PzogbnVtYmVyXG4gIHJlZ2lvbj86IFJlZ2lvblxuICB0cmFuc3BvcnQ/OiBUcmFuc3BvcnRcbiAgc2Vzc2lvblRva2VuPzogc3RyaW5nXG4gIHBhcnRTaXplPzogbnVtYmVyXG4gIHBhdGhTdHlsZT86IGJvb2xlYW5cbiAgY3JlZGVudGlhbHNQcm92aWRlcj86IENyZWRlbnRpYWxQcm92aWRlclxuICBzM0FjY2VsZXJhdGVFbmRwb2ludD86IHN0cmluZ1xuICB0cmFuc3BvcnRBZ2VudD86IGh0dHAuQWdlbnRcbn1cblxuZXhwb3J0IHR5cGUgUmVxdWVzdE9wdGlvbiA9IFBhcnRpYWw8SVJlcXVlc3Q+ICYge1xuICBtZXRob2Q6IHN0cmluZ1xuICBidWNrZXROYW1lPzogc3RyaW5nXG4gIG9iamVjdE5hbWU/OiBzdHJpbmdcbiAgcXVlcnk/OiBzdHJpbmdcbiAgcGF0aFN0eWxlPzogYm9vbGVhblxufVxuXG5leHBvcnQgdHlwZSBOb1Jlc3VsdENhbGxiYWNrID0gKGVycm9yOiB1bmtub3duKSA9PiB2b2lkXG5cbmV4cG9ydCBpbnRlcmZhY2UgTWFrZUJ1Y2tldE9wdCB7XG4gIE9iamVjdExvY2tpbmc/OiBib29sZWFuXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVtb3ZlT3B0aW9ucyB7XG4gIHZlcnNpb25JZD86IHN0cmluZ1xuICBnb3Zlcm5hbmNlQnlwYXNzPzogYm9vbGVhblxuICBmb3JjZURlbGV0ZT86IGJvb2xlYW5cbn1cblxudHlwZSBQYXJ0ID0ge1xuICBwYXJ0OiBudW1iZXJcbiAgZXRhZzogc3RyaW5nXG59XG5cbmV4cG9ydCBjbGFzcyBUeXBlZENsaWVudCB7XG4gIHByb3RlY3RlZCB0cmFuc3BvcnQ6IFRyYW5zcG9ydFxuICBwcm90ZWN0ZWQgaG9zdDogc3RyaW5nXG4gIHByb3RlY3RlZCBwb3J0OiBudW1iZXJcbiAgcHJvdGVjdGVkIHByb3RvY29sOiBzdHJpbmdcbiAgcHJvdGVjdGVkIGFjY2Vzc0tleTogc3RyaW5nXG4gIHByb3RlY3RlZCBzZWNyZXRLZXk6IHN0cmluZ1xuICBwcm90ZWN0ZWQgc2Vzc2lvblRva2VuPzogc3RyaW5nXG4gIHByb3RlY3RlZCB1c2VyQWdlbnQ6IHN0cmluZ1xuICBwcm90ZWN0ZWQgYW5vbnltb3VzOiBib29sZWFuXG4gIHByb3RlY3RlZCBwYXRoU3R5bGU6IGJvb2xlYW5cbiAgcHJvdGVjdGVkIHJlZ2lvbk1hcDogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxuICBwdWJsaWMgcmVnaW9uPzogc3RyaW5nXG4gIHByb3RlY3RlZCBjcmVkZW50aWFsc1Byb3ZpZGVyPzogQ3JlZGVudGlhbFByb3ZpZGVyXG4gIHBhcnRTaXplOiBudW1iZXIgPSA2NCAqIDEwMjQgKiAxMDI0XG4gIHByb3RlY3RlZCBvdmVyUmlkZVBhcnRTaXplPzogYm9vbGVhblxuXG4gIHByb3RlY3RlZCBtYXhpbXVtUGFydFNpemUgPSA1ICogMTAyNCAqIDEwMjQgKiAxMDI0XG4gIHByb3RlY3RlZCBtYXhPYmplY3RTaXplID0gNSAqIDEwMjQgKiAxMDI0ICogMTAyNCAqIDEwMjRcbiAgcHVibGljIGVuYWJsZVNIQTI1NjogYm9vbGVhblxuICBwcm90ZWN0ZWQgczNBY2NlbGVyYXRlRW5kcG9pbnQ/OiBzdHJpbmdcbiAgcHJvdGVjdGVkIHJlcU9wdGlvbnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+XG5cbiAgcHJvdGVjdGVkIHRyYW5zcG9ydEFnZW50OiBodHRwLkFnZW50XG4gIHByaXZhdGUgcmVhZG9ubHkgY2xpZW50RXh0ZW5zaW9uczogRXh0ZW5zaW9uc1xuXG4gIGNvbnN0cnVjdG9yKHBhcmFtczogQ2xpZW50T3B0aW9ucykge1xuICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgZGVwcmVjYXRlZCBwcm9wZXJ0eVxuICAgIGlmIChwYXJhbXMuc2VjdXJlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignXCJzZWN1cmVcIiBvcHRpb24gZGVwcmVjYXRlZCwgXCJ1c2VTU0xcIiBzaG91bGQgYmUgdXNlZCBpbnN0ZWFkJylcbiAgICB9XG4gICAgLy8gRGVmYXVsdCB2YWx1ZXMgaWYgbm90IHNwZWNpZmllZC5cbiAgICBpZiAocGFyYW1zLnVzZVNTTCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYXJhbXMudXNlU1NMID0gdHJ1ZVxuICAgIH1cbiAgICBpZiAoIXBhcmFtcy5wb3J0KSB7XG4gICAgICBwYXJhbXMucG9ydCA9IDBcbiAgICB9XG4gICAgLy8gVmFsaWRhdGUgaW5wdXQgcGFyYW1zLlxuICAgIGlmICghaXNWYWxpZEVuZHBvaW50KHBhcmFtcy5lbmRQb2ludCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEVuZHBvaW50RXJyb3IoYEludmFsaWQgZW5kUG9pbnQgOiAke3BhcmFtcy5lbmRQb2ludH1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRQb3J0KHBhcmFtcy5wb3J0KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCBwb3J0IDogJHtwYXJhbXMucG9ydH1gKVxuICAgIH1cbiAgICBpZiAoIWlzQm9vbGVhbihwYXJhbXMudXNlU1NMKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgYEludmFsaWQgdXNlU1NMIGZsYWcgdHlwZSA6ICR7cGFyYW1zLnVzZVNTTH0sIGV4cGVjdGVkIHRvIGJlIG9mIHR5cGUgXCJib29sZWFuXCJgLFxuICAgICAgKVxuICAgIH1cblxuICAgIC8vIFZhbGlkYXRlIHJlZ2lvbiBvbmx5IGlmIGl0cyBzZXQuXG4gICAgaWYgKHBhcmFtcy5yZWdpb24pIHtcbiAgICAgIGlmICghaXNTdHJpbmcocGFyYW1zLnJlZ2lvbikpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCByZWdpb24gOiAke3BhcmFtcy5yZWdpb259YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBob3N0ID0gcGFyYW1zLmVuZFBvaW50LnRvTG93ZXJDYXNlKClcbiAgICBsZXQgcG9ydCA9IHBhcmFtcy5wb3J0XG4gICAgbGV0IHByb3RvY29sOiBzdHJpbmdcbiAgICBsZXQgdHJhbnNwb3J0XG4gICAgbGV0IHRyYW5zcG9ydEFnZW50OiBodHRwLkFnZW50XG4gICAgLy8gVmFsaWRhdGUgaWYgY29uZmlndXJhdGlvbiBpcyBub3QgdXNpbmcgU1NMXG4gICAgLy8gZm9yIGNvbnN0cnVjdGluZyByZWxldmFudCBlbmRwb2ludHMuXG4gICAgaWYgKHBhcmFtcy51c2VTU0wpIHtcbiAgICAgIC8vIERlZmF1bHRzIHRvIHNlY3VyZS5cbiAgICAgIHRyYW5zcG9ydCA9IGh0dHBzXG4gICAgICBwcm90b2NvbCA9ICdodHRwczonXG4gICAgICBwb3J0ID0gcG9ydCB8fCA0NDNcbiAgICAgIHRyYW5zcG9ydEFnZW50ID0gaHR0cHMuZ2xvYmFsQWdlbnRcbiAgICB9IGVsc2Uge1xuICAgICAgdHJhbnNwb3J0ID0gaHR0cFxuICAgICAgcHJvdG9jb2wgPSAnaHR0cDonXG4gICAgICBwb3J0ID0gcG9ydCB8fCA4MFxuICAgICAgdHJhbnNwb3J0QWdlbnQgPSBodHRwLmdsb2JhbEFnZW50XG4gICAgfVxuXG4gICAgLy8gaWYgY3VzdG9tIHRyYW5zcG9ydCBpcyBzZXQsIHVzZSBpdC5cbiAgICBpZiAocGFyYW1zLnRyYW5zcG9ydCkge1xuICAgICAgaWYgKCFpc09iamVjdChwYXJhbXMudHJhbnNwb3J0KSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICAgIGBJbnZhbGlkIHRyYW5zcG9ydCB0eXBlIDogJHtwYXJhbXMudHJhbnNwb3J0fSwgZXhwZWN0ZWQgdG8gYmUgdHlwZSBcIm9iamVjdFwiYCxcbiAgICAgICAgKVxuICAgICAgfVxuICAgICAgdHJhbnNwb3J0ID0gcGFyYW1zLnRyYW5zcG9ydFxuICAgIH1cblxuICAgIC8vIGlmIGN1c3RvbSB0cmFuc3BvcnQgYWdlbnQgaXMgc2V0LCB1c2UgaXQuXG4gICAgaWYgKHBhcmFtcy50cmFuc3BvcnRBZ2VudCkge1xuICAgICAgaWYgKCFpc09iamVjdChwYXJhbXMudHJhbnNwb3J0QWdlbnQpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgICAgYEludmFsaWQgdHJhbnNwb3J0QWdlbnQgdHlwZTogJHtwYXJhbXMudHJhbnNwb3J0QWdlbnR9LCBleHBlY3RlZCB0byBiZSB0eXBlIFwib2JqZWN0XCJgLFxuICAgICAgICApXG4gICAgICB9XG5cbiAgICAgIHRyYW5zcG9ydEFnZW50ID0gcGFyYW1zLnRyYW5zcG9ydEFnZW50XG4gICAgfVxuXG4gICAgLy8gVXNlciBBZ2VudCBzaG91bGQgYWx3YXlzIGZvbGxvd2luZyB0aGUgYmVsb3cgc3R5bGUuXG4gICAgLy8gUGxlYXNlIG9wZW4gYW4gaXNzdWUgdG8gZGlzY3VzcyBhbnkgbmV3IGNoYW5nZXMgaGVyZS5cbiAgICAvL1xuICAgIC8vICAgICAgIE1pbklPIChPUzsgQVJDSCkgTElCL1ZFUiBBUFAvVkVSXG4gICAgLy9cbiAgICBjb25zdCBsaWJyYXJ5Q29tbWVudHMgPSBgKCR7cHJvY2Vzcy5wbGF0Zm9ybX07ICR7cHJvY2Vzcy5hcmNofSlgXG4gICAgY29uc3QgbGlicmFyeUFnZW50ID0gYE1pbklPICR7bGlicmFyeUNvbW1lbnRzfSBtaW5pby1qcy8ke1BhY2thZ2UudmVyc2lvbn1gXG4gICAgLy8gVXNlciBhZ2VudCBibG9jayBlbmRzLlxuXG4gICAgdGhpcy50cmFuc3BvcnQgPSB0cmFuc3BvcnRcbiAgICB0aGlzLnRyYW5zcG9ydEFnZW50ID0gdHJhbnNwb3J0QWdlbnRcbiAgICB0aGlzLmhvc3QgPSBob3N0XG4gICAgdGhpcy5wb3J0ID0gcG9ydFxuICAgIHRoaXMucHJvdG9jb2wgPSBwcm90b2NvbFxuICAgIHRoaXMudXNlckFnZW50ID0gYCR7bGlicmFyeUFnZW50fWBcblxuICAgIC8vIERlZmF1bHQgcGF0aCBzdHlsZSBpcyB0cnVlXG4gICAgaWYgKHBhcmFtcy5wYXRoU3R5bGUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5wYXRoU3R5bGUgPSB0cnVlXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucGF0aFN0eWxlID0gcGFyYW1zLnBhdGhTdHlsZVxuICAgIH1cblxuICAgIHRoaXMuYWNjZXNzS2V5ID0gcGFyYW1zLmFjY2Vzc0tleSA/PyAnJ1xuICAgIHRoaXMuc2VjcmV0S2V5ID0gcGFyYW1zLnNlY3JldEtleSA/PyAnJ1xuICAgIHRoaXMuc2Vzc2lvblRva2VuID0gcGFyYW1zLnNlc3Npb25Ub2tlblxuICAgIHRoaXMuYW5vbnltb3VzID0gIXRoaXMuYWNjZXNzS2V5IHx8ICF0aGlzLnNlY3JldEtleVxuXG4gICAgaWYgKHBhcmFtcy5jcmVkZW50aWFsc1Byb3ZpZGVyKSB7XG4gICAgICB0aGlzLmFub255bW91cyA9IGZhbHNlXG4gICAgICB0aGlzLmNyZWRlbnRpYWxzUHJvdmlkZXIgPSBwYXJhbXMuY3JlZGVudGlhbHNQcm92aWRlclxuICAgIH1cblxuICAgIHRoaXMucmVnaW9uTWFwID0ge31cbiAgICBpZiAocGFyYW1zLnJlZ2lvbikge1xuICAgICAgdGhpcy5yZWdpb24gPSBwYXJhbXMucmVnaW9uXG4gICAgfVxuXG4gICAgaWYgKHBhcmFtcy5wYXJ0U2l6ZSkge1xuICAgICAgdGhpcy5wYXJ0U2l6ZSA9IHBhcmFtcy5wYXJ0U2l6ZVxuICAgICAgdGhpcy5vdmVyUmlkZVBhcnRTaXplID0gdHJ1ZVxuICAgIH1cbiAgICBpZiAodGhpcy5wYXJ0U2l6ZSA8IDUgKiAxMDI0ICogMTAyNCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgUGFydCBzaXplIHNob3VsZCBiZSBncmVhdGVyIHRoYW4gNU1CYClcbiAgICB9XG4gICAgaWYgKHRoaXMucGFydFNpemUgPiA1ICogMTAyNCAqIDEwMjQgKiAxMDI0KSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBQYXJ0IHNpemUgc2hvdWxkIGJlIGxlc3MgdGhhbiA1R0JgKVxuICAgIH1cblxuICAgIC8vIFNIQTI1NiBpcyBlbmFibGVkIG9ubHkgZm9yIGF1dGhlbnRpY2F0ZWQgaHR0cCByZXF1ZXN0cy4gSWYgdGhlIHJlcXVlc3QgaXMgYXV0aGVudGljYXRlZFxuICAgIC8vIGFuZCB0aGUgY29ubmVjdGlvbiBpcyBodHRwcyB3ZSB1c2UgeC1hbXotY29udGVudC1zaGEyNTY9VU5TSUdORUQtUEFZTE9BRFxuICAgIC8vIGhlYWRlciBmb3Igc2lnbmF0dXJlIGNhbGN1bGF0aW9uLlxuICAgIHRoaXMuZW5hYmxlU0hBMjU2ID0gIXRoaXMuYW5vbnltb3VzICYmICFwYXJhbXMudXNlU1NMXG5cbiAgICB0aGlzLnMzQWNjZWxlcmF0ZUVuZHBvaW50ID0gcGFyYW1zLnMzQWNjZWxlcmF0ZUVuZHBvaW50IHx8IHVuZGVmaW5lZFxuICAgIHRoaXMucmVxT3B0aW9ucyA9IHt9XG4gICAgdGhpcy5jbGllbnRFeHRlbnNpb25zID0gbmV3IEV4dGVuc2lvbnModGhpcylcbiAgfVxuICAvKipcbiAgICogTWluaW8gZXh0ZW5zaW9ucyB0aGF0IGFyZW4ndCBuZWNlc3NhcnkgcHJlc2VudCBmb3IgQW1hem9uIFMzIGNvbXBhdGlibGUgc3RvcmFnZSBzZXJ2ZXJzXG4gICAqL1xuICBnZXQgZXh0ZW5zaW9ucygpIHtcbiAgICByZXR1cm4gdGhpcy5jbGllbnRFeHRlbnNpb25zXG4gIH1cblxuICAvKipcbiAgICogQHBhcmFtIGVuZFBvaW50IC0gdmFsaWQgUzMgYWNjZWxlcmF0aW9uIGVuZCBwb2ludFxuICAgKi9cbiAgc2V0UzNUcmFuc2ZlckFjY2VsZXJhdGUoZW5kUG9pbnQ6IHN0cmluZykge1xuICAgIHRoaXMuczNBY2NlbGVyYXRlRW5kcG9pbnQgPSBlbmRQb2ludFxuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdGhlIHN1cHBvcnRlZCByZXF1ZXN0IG9wdGlvbnMuXG4gICAqL1xuICBwdWJsaWMgc2V0UmVxdWVzdE9wdGlvbnMob3B0aW9uczogUGljazxodHRwcy5SZXF1ZXN0T3B0aW9ucywgKHR5cGVvZiByZXF1ZXN0T3B0aW9uUHJvcGVydGllcylbbnVtYmVyXT4pIHtcbiAgICBpZiAoIWlzT2JqZWN0KG9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXF1ZXN0IG9wdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIHRoaXMucmVxT3B0aW9ucyA9IF8ucGljayhvcHRpb25zLCByZXF1ZXN0T3B0aW9uUHJvcGVydGllcylcbiAgfVxuXG4gIC8qKlxuICAgKiAgVGhpcyBpcyBzMyBTcGVjaWZpYyBhbmQgZG9lcyBub3QgaG9sZCB2YWxpZGl0eSBpbiBhbnkgb3RoZXIgT2JqZWN0IHN0b3JhZ2UuXG4gICAqL1xuICBwcml2YXRlIGdldEFjY2VsZXJhdGVFbmRQb2ludElmU2V0KGJ1Y2tldE5hbWU/OiBzdHJpbmcsIG9iamVjdE5hbWU/OiBzdHJpbmcpIHtcbiAgICBpZiAoIWlzRW1wdHkodGhpcy5zM0FjY2VsZXJhdGVFbmRwb2ludCkgJiYgIWlzRW1wdHkoYnVja2V0TmFtZSkgJiYgIWlzRW1wdHkob2JqZWN0TmFtZSkpIHtcbiAgICAgIC8vIGh0dHA6Ly9kb2NzLmF3cy5hbWF6b24uY29tL0FtYXpvblMzL2xhdGVzdC9kZXYvdHJhbnNmZXItYWNjZWxlcmF0aW9uLmh0bWxcbiAgICAgIC8vIERpc2FibGUgdHJhbnNmZXIgYWNjZWxlcmF0aW9uIGZvciBub24tY29tcGxpYW50IGJ1Y2tldCBuYW1lcy5cbiAgICAgIGlmIChidWNrZXROYW1lLmluY2x1ZGVzKCcuJykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUcmFuc2ZlciBBY2NlbGVyYXRpb24gaXMgbm90IHN1cHBvcnRlZCBmb3Igbm9uIGNvbXBsaWFudCBidWNrZXQ6JHtidWNrZXROYW1lfWApXG4gICAgICB9XG4gICAgICAvLyBJZiB0cmFuc2ZlciBhY2NlbGVyYXRpb24gaXMgcmVxdWVzdGVkIHNldCBuZXcgaG9zdC5cbiAgICAgIC8vIEZvciBtb3JlIGRldGFpbHMgYWJvdXQgZW5hYmxpbmcgdHJhbnNmZXIgYWNjZWxlcmF0aW9uIHJlYWQgaGVyZS5cbiAgICAgIC8vIGh0dHA6Ly9kb2NzLmF3cy5hbWF6b24uY29tL0FtYXpvblMzL2xhdGVzdC9kZXYvdHJhbnNmZXItYWNjZWxlcmF0aW9uLmh0bWxcbiAgICAgIHJldHVybiB0aGlzLnMzQWNjZWxlcmF0ZUVuZHBvaW50XG4gICAgfVxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqICAgU2V0IGFwcGxpY2F0aW9uIHNwZWNpZmljIGluZm9ybWF0aW9uLlxuICAgKiAgIEdlbmVyYXRlcyBVc2VyLUFnZW50IGluIHRoZSBmb2xsb3dpbmcgc3R5bGUuXG4gICAqICAgTWluSU8gKE9TOyBBUkNIKSBMSUIvVkVSIEFQUC9WRVJcbiAgICovXG4gIHNldEFwcEluZm8oYXBwTmFtZTogc3RyaW5nLCBhcHBWZXJzaW9uOiBzdHJpbmcpIHtcbiAgICBpZiAoIWlzU3RyaW5nKGFwcE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBJbnZhbGlkIGFwcE5hbWU6ICR7YXBwTmFtZX1gKVxuICAgIH1cbiAgICBpZiAoYXBwTmFtZS50cmltKCkgPT09ICcnKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdJbnB1dCBhcHBOYW1lIGNhbm5vdCBiZSBlbXB0eS4nKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKGFwcFZlcnNpb24pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBJbnZhbGlkIGFwcFZlcnNpb246ICR7YXBwVmVyc2lvbn1gKVxuICAgIH1cbiAgICBpZiAoYXBwVmVyc2lvbi50cmltKCkgPT09ICcnKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdJbnB1dCBhcHBWZXJzaW9uIGNhbm5vdCBiZSBlbXB0eS4nKVxuICAgIH1cbiAgICB0aGlzLnVzZXJBZ2VudCA9IGAke3RoaXMudXNlckFnZW50fSAke2FwcE5hbWV9LyR7YXBwVmVyc2lvbn1gXG4gIH1cblxuICAvKipcbiAgICogcmV0dXJucyBvcHRpb25zIG9iamVjdCB0aGF0IGNhbiBiZSB1c2VkIHdpdGggaHR0cC5yZXF1ZXN0KClcbiAgICogVGFrZXMgY2FyZSBvZiBjb25zdHJ1Y3RpbmcgdmlydHVhbC1ob3N0LXN0eWxlIG9yIHBhdGgtc3R5bGUgaG9zdG5hbWVcbiAgICovXG4gIHByb3RlY3RlZCBnZXRSZXF1ZXN0T3B0aW9ucyhcbiAgICBvcHRzOiBSZXF1ZXN0T3B0aW9uICYge1xuICAgICAgcmVnaW9uOiBzdHJpbmdcbiAgICB9LFxuICApOiBJUmVxdWVzdCAmIHtcbiAgICBob3N0OiBzdHJpbmdcbiAgICBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG4gIH0ge1xuICAgIGNvbnN0IG1ldGhvZCA9IG9wdHMubWV0aG9kXG4gICAgY29uc3QgcmVnaW9uID0gb3B0cy5yZWdpb25cbiAgICBjb25zdCBidWNrZXROYW1lID0gb3B0cy5idWNrZXROYW1lXG4gICAgbGV0IG9iamVjdE5hbWUgPSBvcHRzLm9iamVjdE5hbWVcbiAgICBjb25zdCBoZWFkZXJzID0gb3B0cy5oZWFkZXJzXG4gICAgY29uc3QgcXVlcnkgPSBvcHRzLnF1ZXJ5XG5cbiAgICBsZXQgcmVxT3B0aW9ucyA9IHtcbiAgICAgIG1ldGhvZCxcbiAgICAgIGhlYWRlcnM6IHt9IGFzIFJlcXVlc3RIZWFkZXJzLFxuICAgICAgcHJvdG9jb2w6IHRoaXMucHJvdG9jb2wsXG4gICAgICAvLyBJZiBjdXN0b20gdHJhbnNwb3J0QWdlbnQgd2FzIHN1cHBsaWVkIGVhcmxpZXIsIHdlJ2xsIGluamVjdCBpdCBoZXJlXG4gICAgICBhZ2VudDogdGhpcy50cmFuc3BvcnRBZ2VudCxcbiAgICB9XG5cbiAgICAvLyBWZXJpZnkgaWYgdmlydHVhbCBob3N0IHN1cHBvcnRlZC5cbiAgICBsZXQgdmlydHVhbEhvc3RTdHlsZVxuICAgIGlmIChidWNrZXROYW1lKSB7XG4gICAgICB2aXJ0dWFsSG9zdFN0eWxlID0gaXNWaXJ0dWFsSG9zdFN0eWxlKHRoaXMuaG9zdCwgdGhpcy5wcm90b2NvbCwgYnVja2V0TmFtZSwgdGhpcy5wYXRoU3R5bGUpXG4gICAgfVxuXG4gICAgbGV0IHBhdGggPSAnLydcbiAgICBsZXQgaG9zdCA9IHRoaXMuaG9zdFxuXG4gICAgbGV0IHBvcnQ6IHVuZGVmaW5lZCB8IG51bWJlclxuICAgIGlmICh0aGlzLnBvcnQpIHtcbiAgICAgIHBvcnQgPSB0aGlzLnBvcnRcbiAgICB9XG5cbiAgICBpZiAob2JqZWN0TmFtZSkge1xuICAgICAgb2JqZWN0TmFtZSA9IHVyaVJlc291cmNlRXNjYXBlKG9iamVjdE5hbWUpXG4gICAgfVxuXG4gICAgLy8gRm9yIEFtYXpvbiBTMyBlbmRwb2ludCwgZ2V0IGVuZHBvaW50IGJhc2VkIG9uIHJlZ2lvbi5cbiAgICBpZiAoaXNBbWF6b25FbmRwb2ludChob3N0KSkge1xuICAgICAgY29uc3QgYWNjZWxlcmF0ZUVuZFBvaW50ID0gdGhpcy5nZXRBY2NlbGVyYXRlRW5kUG9pbnRJZlNldChidWNrZXROYW1lLCBvYmplY3ROYW1lKVxuICAgICAgaWYgKGFjY2VsZXJhdGVFbmRQb2ludCkge1xuICAgICAgICBob3N0ID0gYCR7YWNjZWxlcmF0ZUVuZFBvaW50fWBcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGhvc3QgPSBnZXRTM0VuZHBvaW50KHJlZ2lvbilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodmlydHVhbEhvc3RTdHlsZSAmJiAhb3B0cy5wYXRoU3R5bGUpIHtcbiAgICAgIC8vIEZvciBhbGwgaG9zdHMgd2hpY2ggc3VwcG9ydCB2aXJ0dWFsIGhvc3Qgc3R5bGUsIGBidWNrZXROYW1lYFxuICAgICAgLy8gaXMgcGFydCBvZiB0aGUgaG9zdG5hbWUgaW4gdGhlIGZvbGxvd2luZyBmb3JtYXQ6XG4gICAgICAvL1xuICAgICAgLy8gIHZhciBob3N0ID0gJ2J1Y2tldE5hbWUuZXhhbXBsZS5jb20nXG4gICAgICAvL1xuICAgICAgaWYgKGJ1Y2tldE5hbWUpIHtcbiAgICAgICAgaG9zdCA9IGAke2J1Y2tldE5hbWV9LiR7aG9zdH1gXG4gICAgICB9XG4gICAgICBpZiAob2JqZWN0TmFtZSkge1xuICAgICAgICBwYXRoID0gYC8ke29iamVjdE5hbWV9YFxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBGb3IgYWxsIFMzIGNvbXBhdGlibGUgc3RvcmFnZSBzZXJ2aWNlcyB3ZSB3aWxsIGZhbGxiYWNrIHRvXG4gICAgICAvLyBwYXRoIHN0eWxlIHJlcXVlc3RzLCB3aGVyZSBgYnVja2V0TmFtZWAgaXMgcGFydCBvZiB0aGUgVVJJXG4gICAgICAvLyBwYXRoLlxuICAgICAgaWYgKGJ1Y2tldE5hbWUpIHtcbiAgICAgICAgcGF0aCA9IGAvJHtidWNrZXROYW1lfWBcbiAgICAgIH1cbiAgICAgIGlmIChvYmplY3ROYW1lKSB7XG4gICAgICAgIHBhdGggPSBgLyR7YnVja2V0TmFtZX0vJHtvYmplY3ROYW1lfWBcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocXVlcnkpIHtcbiAgICAgIHBhdGggKz0gYD8ke3F1ZXJ5fWBcbiAgICB9XG4gICAgcmVxT3B0aW9ucy5oZWFkZXJzLmhvc3QgPSBob3N0XG4gICAgaWYgKChyZXFPcHRpb25zLnByb3RvY29sID09PSAnaHR0cDonICYmIHBvcnQgIT09IDgwKSB8fCAocmVxT3B0aW9ucy5wcm90b2NvbCA9PT0gJ2h0dHBzOicgJiYgcG9ydCAhPT0gNDQzKSkge1xuICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzLmhvc3QgPSBqb2luSG9zdFBvcnQoaG9zdCwgcG9ydClcbiAgICB9XG5cbiAgICByZXFPcHRpb25zLmhlYWRlcnNbJ3VzZXItYWdlbnQnXSA9IHRoaXMudXNlckFnZW50XG4gICAgaWYgKGhlYWRlcnMpIHtcbiAgICAgIC8vIGhhdmUgYWxsIGhlYWRlciBrZXlzIGluIGxvd2VyIGNhc2UgLSB0byBtYWtlIHNpZ25pbmcgZWFzeVxuICAgICAgZm9yIChjb25zdCBbaywgdl0gb2YgT2JqZWN0LmVudHJpZXMoaGVhZGVycykpIHtcbiAgICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzW2sudG9Mb3dlckNhc2UoKV0gPSB2XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gVXNlIGFueSByZXF1ZXN0IG9wdGlvbiBzcGVjaWZpZWQgaW4gbWluaW9DbGllbnQuc2V0UmVxdWVzdE9wdGlvbnMoKVxuICAgIHJlcU9wdGlvbnMgPSBPYmplY3QuYXNzaWduKHt9LCB0aGlzLnJlcU9wdGlvbnMsIHJlcU9wdGlvbnMpXG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4ucmVxT3B0aW9ucyxcbiAgICAgIGhlYWRlcnM6IF8ubWFwVmFsdWVzKF8ucGlja0J5KHJlcU9wdGlvbnMuaGVhZGVycywgaXNEZWZpbmVkKSwgKHYpID0+IHYudG9TdHJpbmcoKSksXG4gICAgICBob3N0LFxuICAgICAgcG9ydCxcbiAgICAgIHBhdGgsXG4gICAgfSBzYXRpc2ZpZXMgaHR0cHMuUmVxdWVzdE9wdGlvbnNcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBzZXRDcmVkZW50aWFsc1Byb3ZpZGVyKGNyZWRlbnRpYWxzUHJvdmlkZXI6IENyZWRlbnRpYWxQcm92aWRlcikge1xuICAgIGlmICghKGNyZWRlbnRpYWxzUHJvdmlkZXIgaW5zdGFuY2VvZiBDcmVkZW50aWFsUHJvdmlkZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VuYWJsZSB0byBnZXQgY3JlZGVudGlhbHMuIEV4cGVjdGVkIGluc3RhbmNlIG9mIENyZWRlbnRpYWxQcm92aWRlcicpXG4gICAgfVxuICAgIHRoaXMuY3JlZGVudGlhbHNQcm92aWRlciA9IGNyZWRlbnRpYWxzUHJvdmlkZXJcbiAgICBhd2FpdCB0aGlzLmNoZWNrQW5kUmVmcmVzaENyZWRzKClcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY2hlY2tBbmRSZWZyZXNoQ3JlZHMoKSB7XG4gICAgaWYgKHRoaXMuY3JlZGVudGlhbHNQcm92aWRlcikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgY3JlZGVudGlhbHNDb25mID0gYXdhaXQgdGhpcy5jcmVkZW50aWFsc1Byb3ZpZGVyLmdldENyZWRlbnRpYWxzKClcbiAgICAgICAgdGhpcy5hY2Nlc3NLZXkgPSBjcmVkZW50aWFsc0NvbmYuZ2V0QWNjZXNzS2V5KClcbiAgICAgICAgdGhpcy5zZWNyZXRLZXkgPSBjcmVkZW50aWFsc0NvbmYuZ2V0U2VjcmV0S2V5KClcbiAgICAgICAgdGhpcy5zZXNzaW9uVG9rZW4gPSBjcmVkZW50aWFsc0NvbmYuZ2V0U2Vzc2lvblRva2VuKClcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gZ2V0IGNyZWRlbnRpYWxzOiAke2V9YCwgeyBjYXVzZTogZSB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgbG9nU3RyZWFtPzogc3RyZWFtLldyaXRhYmxlXG5cbiAgLyoqXG4gICAqIGxvZyB0aGUgcmVxdWVzdCwgcmVzcG9uc2UsIGVycm9yXG4gICAqL1xuICBwcml2YXRlIGxvZ0hUVFAocmVxT3B0aW9uczogSVJlcXVlc3QsIHJlc3BvbnNlOiBodHRwLkluY29taW5nTWVzc2FnZSB8IG51bGwsIGVycj86IHVua25vd24pIHtcbiAgICAvLyBpZiBubyBsb2dTdHJlYW0gYXZhaWxhYmxlIHJldHVybi5cbiAgICBpZiAoIXRoaXMubG9nU3RyZWFtKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChyZXFPcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVxT3B0aW9ucyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKHJlc3BvbnNlICYmICFpc1JlYWRhYmxlU3RyZWFtKHJlc3BvbnNlKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVzcG9uc2Ugc2hvdWxkIGJlIG9mIHR5cGUgXCJTdHJlYW1cIicpXG4gICAgfVxuICAgIGlmIChlcnIgJiYgIShlcnIgaW5zdGFuY2VvZiBFcnJvcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2VyciBzaG91bGQgYmUgb2YgdHlwZSBcIkVycm9yXCInKVxuICAgIH1cbiAgICBjb25zdCBsb2dTdHJlYW0gPSB0aGlzLmxvZ1N0cmVhbVxuICAgIGNvbnN0IGxvZ0hlYWRlcnMgPSAoaGVhZGVyczogUmVxdWVzdEhlYWRlcnMpID0+IHtcbiAgICAgIE9iamVjdC5lbnRyaWVzKGhlYWRlcnMpLmZvckVhY2goKFtrLCB2XSkgPT4ge1xuICAgICAgICBpZiAoayA9PSAnYXV0aG9yaXphdGlvbicpIHtcbiAgICAgICAgICBpZiAoaXNTdHJpbmcodikpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlZGFjdG9yID0gbmV3IFJlZ0V4cCgnU2lnbmF0dXJlPShbMC05YS1mXSspJylcbiAgICAgICAgICAgIHYgPSB2LnJlcGxhY2UocmVkYWN0b3IsICdTaWduYXR1cmU9KipSRURBQ1RFRCoqJylcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgbG9nU3RyZWFtLndyaXRlKGAke2t9OiAke3Z9XFxuYClcbiAgICAgIH0pXG4gICAgICBsb2dTdHJlYW0ud3JpdGUoJ1xcbicpXG4gICAgfVxuICAgIGxvZ1N0cmVhbS53cml0ZShgUkVRVUVTVDogJHtyZXFPcHRpb25zLm1ldGhvZH0gJHtyZXFPcHRpb25zLnBhdGh9XFxuYClcbiAgICBsb2dIZWFkZXJzKHJlcU9wdGlvbnMuaGVhZGVycylcbiAgICBpZiAocmVzcG9uc2UpIHtcbiAgICAgIHRoaXMubG9nU3RyZWFtLndyaXRlKGBSRVNQT05TRTogJHtyZXNwb25zZS5zdGF0dXNDb2RlfVxcbmApXG4gICAgICBsb2dIZWFkZXJzKHJlc3BvbnNlLmhlYWRlcnMgYXMgUmVxdWVzdEhlYWRlcnMpXG4gICAgfVxuICAgIGlmIChlcnIpIHtcbiAgICAgIGxvZ1N0cmVhbS53cml0ZSgnRVJST1IgQk9EWTpcXG4nKVxuICAgICAgY29uc3QgZXJySlNPTiA9IEpTT04uc3RyaW5naWZ5KGVyciwgbnVsbCwgJ1xcdCcpXG4gICAgICBsb2dTdHJlYW0ud3JpdGUoYCR7ZXJySlNPTn1cXG5gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbmFibGUgdHJhY2luZ1xuICAgKi9cbiAgcHVibGljIHRyYWNlT24oc3RyZWFtPzogc3RyZWFtLldyaXRhYmxlKSB7XG4gICAgaWYgKCFzdHJlYW0pIHtcbiAgICAgIHN0cmVhbSA9IHByb2Nlc3Muc3Rkb3V0XG4gICAgfVxuICAgIHRoaXMubG9nU3RyZWFtID0gc3RyZWFtXG4gIH1cblxuICAvKipcbiAgICogRGlzYWJsZSB0cmFjaW5nXG4gICAqL1xuICBwdWJsaWMgdHJhY2VPZmYoKSB7XG4gICAgdGhpcy5sb2dTdHJlYW0gPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBtYWtlUmVxdWVzdCBpcyB0aGUgcHJpbWl0aXZlIHVzZWQgYnkgdGhlIGFwaXMgZm9yIG1ha2luZyBTMyByZXF1ZXN0cy5cbiAgICogcGF5bG9hZCBjYW4gYmUgZW1wdHkgc3RyaW5nIGluIGNhc2Ugb2Ygbm8gcGF5bG9hZC5cbiAgICogc3RhdHVzQ29kZSBpcyB0aGUgZXhwZWN0ZWQgc3RhdHVzQ29kZS4gSWYgcmVzcG9uc2Uuc3RhdHVzQ29kZSBkb2VzIG5vdCBtYXRjaFxuICAgKiB3ZSBwYXJzZSB0aGUgWE1MIGVycm9yIGFuZCBjYWxsIHRoZSBjYWxsYmFjayB3aXRoIHRoZSBlcnJvciBtZXNzYWdlLlxuICAgKlxuICAgKiBBIHZhbGlkIHJlZ2lvbiBpcyBwYXNzZWQgYnkgdGhlIGNhbGxzIC0gbGlzdEJ1Y2tldHMsIG1ha2VCdWNrZXQgYW5kIGdldEJ1Y2tldFJlZ2lvbi5cbiAgICpcbiAgICogQGludGVybmFsXG4gICAqL1xuICBhc3luYyBtYWtlUmVxdWVzdEFzeW5jKFxuICAgIG9wdGlvbnM6IFJlcXVlc3RPcHRpb24sXG4gICAgcGF5bG9hZDogQmluYXJ5ID0gJycsXG4gICAgZXhwZWN0ZWRDb2RlczogbnVtYmVyW10gPSBbMjAwXSxcbiAgICByZWdpb24gPSAnJyxcbiAgKTogUHJvbWlzZTxodHRwLkluY29taW5nTWVzc2FnZT4ge1xuICAgIGlmICghaXNPYmplY3Qob3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocGF5bG9hZCkgJiYgIWlzT2JqZWN0KHBheWxvYWQpKSB7XG4gICAgICAvLyBCdWZmZXIgaXMgb2YgdHlwZSAnb2JqZWN0J1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncGF5bG9hZCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiIG9yIFwiQnVmZmVyXCInKVxuICAgIH1cbiAgICBleHBlY3RlZENvZGVzLmZvckVhY2goKHN0YXR1c0NvZGUpID0+IHtcbiAgICAgIGlmICghaXNOdW1iZXIoc3RhdHVzQ29kZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc3RhdHVzQ29kZSBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICAgIH1cbiAgICB9KVxuICAgIGlmICghaXNTdHJpbmcocmVnaW9uKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVnaW9uIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIW9wdGlvbnMuaGVhZGVycykge1xuICAgICAgb3B0aW9ucy5oZWFkZXJzID0ge31cbiAgICB9XG4gICAgaWYgKG9wdGlvbnMubWV0aG9kID09PSAnUE9TVCcgfHwgb3B0aW9ucy5tZXRob2QgPT09ICdQVVQnIHx8IG9wdGlvbnMubWV0aG9kID09PSAnREVMRVRFJykge1xuICAgICAgb3B0aW9ucy5oZWFkZXJzWydjb250ZW50LWxlbmd0aCddID0gcGF5bG9hZC5sZW5ndGgudG9TdHJpbmcoKVxuICAgIH1cbiAgICBjb25zdCBzaGEyNTZzdW0gPSB0aGlzLmVuYWJsZVNIQTI1NiA/IHRvU2hhMjU2KHBheWxvYWQpIDogJydcbiAgICByZXR1cm4gdGhpcy5tYWtlUmVxdWVzdFN0cmVhbUFzeW5jKG9wdGlvbnMsIHBheWxvYWQsIHNoYTI1NnN1bSwgZXhwZWN0ZWRDb2RlcywgcmVnaW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIG5ldyByZXF1ZXN0IHdpdGggcHJvbWlzZVxuICAgKlxuICAgKiBObyBuZWVkIHRvIGRyYWluIHJlc3BvbnNlLCByZXNwb25zZSBib2R5IGlzIG5vdCB2YWxpZFxuICAgKi9cbiAgYXN5bmMgbWFrZVJlcXVlc3RBc3luY09taXQoXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcbiAgICBwYXlsb2FkOiBCaW5hcnkgPSAnJyxcbiAgICBzdGF0dXNDb2RlczogbnVtYmVyW10gPSBbMjAwXSxcbiAgICByZWdpb24gPSAnJyxcbiAgKTogUHJvbWlzZTxPbWl0PGh0dHAuSW5jb21pbmdNZXNzYWdlLCAnb24nPj4ge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhvcHRpb25zLCBwYXlsb2FkLCBzdGF0dXNDb2RlcywgcmVnaW9uKVxuICAgIGF3YWl0IGRyYWluUmVzcG9uc2UocmVzKVxuICAgIHJldHVybiByZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBtYWtlUmVxdWVzdFN0cmVhbSB3aWxsIGJlIHVzZWQgZGlyZWN0bHkgaW5zdGVhZCBvZiBtYWtlUmVxdWVzdCBpbiBjYXNlIHRoZSBwYXlsb2FkXG4gICAqIGlzIGF2YWlsYWJsZSBhcyBhIHN0cmVhbS4gZm9yIGV4LiBwdXRPYmplY3RcbiAgICpcbiAgICogQGludGVybmFsXG4gICAqL1xuICBhc3luYyBtYWtlUmVxdWVzdFN0cmVhbUFzeW5jKFxuICAgIG9wdGlvbnM6IFJlcXVlc3RPcHRpb24sXG4gICAgYm9keTogc3RyZWFtLlJlYWRhYmxlIHwgQmluYXJ5LFxuICAgIHNoYTI1NnN1bTogc3RyaW5nLFxuICAgIHN0YXR1c0NvZGVzOiBudW1iZXJbXSxcbiAgICByZWdpb246IHN0cmluZyxcbiAgKTogUHJvbWlzZTxodHRwLkluY29taW5nTWVzc2FnZT4ge1xuICAgIGlmICghaXNPYmplY3Qob3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmICghKEJ1ZmZlci5pc0J1ZmZlcihib2R5KSB8fCB0eXBlb2YgYm9keSA9PT0gJ3N0cmluZycgfHwgaXNSZWFkYWJsZVN0cmVhbShib2R5KSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgIGBzdHJlYW0gc2hvdWxkIGJlIGEgQnVmZmVyLCBzdHJpbmcgb3IgcmVhZGFibGUgU3RyZWFtLCBnb3QgJHt0eXBlb2YgYm9keX0gaW5zdGVhZGAsXG4gICAgICApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoc2hhMjU2c3VtKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc2hhMjU2c3VtIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBzdGF0dXNDb2Rlcy5mb3JFYWNoKChzdGF0dXNDb2RlKSA9PiB7XG4gICAgICBpZiAoIWlzTnVtYmVyKHN0YXR1c0NvZGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N0YXR1c0NvZGUgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgICB9XG4gICAgfSlcbiAgICBpZiAoIWlzU3RyaW5nKHJlZ2lvbikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlZ2lvbiBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgLy8gc2hhMjU2c3VtIHdpbGwgYmUgZW1wdHkgZm9yIGFub255bW91cyBvciBodHRwcyByZXF1ZXN0c1xuICAgIGlmICghdGhpcy5lbmFibGVTSEEyNTYgJiYgc2hhMjU2c3VtLmxlbmd0aCAhPT0gMCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgc2hhMjU2c3VtIGV4cGVjdGVkIHRvIGJlIGVtcHR5IGZvciBhbm9ueW1vdXMgb3IgaHR0cHMgcmVxdWVzdHNgKVxuICAgIH1cbiAgICAvLyBzaGEyNTZzdW0gc2hvdWxkIGJlIHZhbGlkIGZvciBub24tYW5vbnltb3VzIGh0dHAgcmVxdWVzdHMuXG4gICAgaWYgKHRoaXMuZW5hYmxlU0hBMjU2ICYmIHNoYTI1NnN1bS5sZW5ndGggIT09IDY0KSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHNoYTI1NnN1bSA6ICR7c2hhMjU2c3VtfWApXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5jaGVja0FuZFJlZnJlc2hDcmVkcygpXG5cbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLW5vbi1udWxsLWFzc2VydGlvblxuICAgIHJlZ2lvbiA9IHJlZ2lvbiB8fCAoYXdhaXQgdGhpcy5nZXRCdWNrZXRSZWdpb25Bc3luYyhvcHRpb25zLmJ1Y2tldE5hbWUhKSlcblxuICAgIGNvbnN0IHJlcU9wdGlvbnMgPSB0aGlzLmdldFJlcXVlc3RPcHRpb25zKHsgLi4ub3B0aW9ucywgcmVnaW9uIH0pXG4gICAgaWYgKCF0aGlzLmFub255bW91cykge1xuICAgICAgLy8gRm9yIG5vbi1hbm9ueW1vdXMgaHR0cHMgcmVxdWVzdHMgc2hhMjU2c3VtIGlzICdVTlNJR05FRC1QQVlMT0FEJyBmb3Igc2lnbmF0dXJlIGNhbGN1bGF0aW9uLlxuICAgICAgaWYgKCF0aGlzLmVuYWJsZVNIQTI1Nikge1xuICAgICAgICBzaGEyNTZzdW0gPSAnVU5TSUdORUQtUEFZTE9BRCdcbiAgICAgIH1cbiAgICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZSgpXG4gICAgICByZXFPcHRpb25zLmhlYWRlcnNbJ3gtYW16LWRhdGUnXSA9IG1ha2VEYXRlTG9uZyhkYXRlKVxuICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzWyd4LWFtei1jb250ZW50LXNoYTI1NiddID0gc2hhMjU2c3VtXG4gICAgICBpZiAodGhpcy5zZXNzaW9uVG9rZW4pIHtcbiAgICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzWyd4LWFtei1zZWN1cml0eS10b2tlbiddID0gdGhpcy5zZXNzaW9uVG9rZW5cbiAgICAgIH1cbiAgICAgIHJlcU9wdGlvbnMuaGVhZGVycy5hdXRob3JpemF0aW9uID0gc2lnblY0KHJlcU9wdGlvbnMsIHRoaXMuYWNjZXNzS2V5LCB0aGlzLnNlY3JldEtleSwgcmVnaW9uLCBkYXRlLCBzaGEyNTZzdW0pXG4gICAgfVxuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCByZXF1ZXN0V2l0aFJldHJ5KHRoaXMudHJhbnNwb3J0LCByZXFPcHRpb25zLCBib2R5KVxuICAgIGlmICghcmVzcG9uc2Uuc3RhdHVzQ29kZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQlVHOiByZXNwb25zZSBkb2Vzbid0IGhhdmUgYSBzdGF0dXNDb2RlXCIpXG4gICAgfVxuXG4gICAgaWYgKCFzdGF0dXNDb2Rlcy5pbmNsdWRlcyhyZXNwb25zZS5zdGF0dXNDb2RlKSkge1xuICAgICAgLy8gRm9yIGFuIGluY29ycmVjdCByZWdpb24sIFMzIHNlcnZlciBhbHdheXMgc2VuZHMgYmFjayA0MDAuXG4gICAgICAvLyBCdXQgd2Ugd2lsbCBkbyBjYWNoZSBpbnZhbGlkYXRpb24gZm9yIGFsbCBlcnJvcnMgc28gdGhhdCxcbiAgICAgIC8vIGluIGZ1dHVyZSwgaWYgQVdTIFMzIGRlY2lkZXMgdG8gc2VuZCBhIGRpZmZlcmVudCBzdGF0dXMgY29kZSBvclxuICAgICAgLy8gWE1MIGVycm9yIGNvZGUgd2Ugd2lsbCBzdGlsbCB3b3JrIGZpbmUuXG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLW5vbi1udWxsLWFzc2VydGlvblxuICAgICAgZGVsZXRlIHRoaXMucmVnaW9uTWFwW29wdGlvbnMuYnVja2V0TmFtZSFdXG5cbiAgICAgIGNvbnN0IGVyciA9IGF3YWl0IHhtbFBhcnNlcnMucGFyc2VSZXNwb25zZUVycm9yKHJlc3BvbnNlKVxuICAgICAgdGhpcy5sb2dIVFRQKHJlcU9wdGlvbnMsIHJlc3BvbnNlLCBlcnIpXG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG5cbiAgICB0aGlzLmxvZ0hUVFAocmVxT3B0aW9ucywgcmVzcG9uc2UpXG5cbiAgICByZXR1cm4gcmVzcG9uc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBnZXRzIHRoZSByZWdpb24gb2YgdGhlIGJ1Y2tldFxuICAgKlxuICAgKiBAcGFyYW0gYnVja2V0TmFtZVxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHByb3RlY3RlZCBhc3luYyBnZXRCdWNrZXRSZWdpb25Bc3luYyhidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZSA6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cblxuICAgIC8vIFJlZ2lvbiBpcyBzZXQgd2l0aCBjb25zdHJ1Y3RvciwgcmV0dXJuIHRoZSByZWdpb24gcmlnaHQgaGVyZS5cbiAgICBpZiAodGhpcy5yZWdpb24pIHtcbiAgICAgIHJldHVybiB0aGlzLnJlZ2lvblxuICAgIH1cblxuICAgIGNvbnN0IGNhY2hlZCA9IHRoaXMucmVnaW9uTWFwW2J1Y2tldE5hbWVdXG4gICAgaWYgKGNhY2hlZCkge1xuICAgICAgcmV0dXJuIGNhY2hlZFxuICAgIH1cblxuICAgIGNvbnN0IGV4dHJhY3RSZWdpb25Bc3luYyA9IGFzeW5jIChyZXNwb25zZTogaHR0cC5JbmNvbWluZ01lc3NhZ2UpID0+IHtcbiAgICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzcG9uc2UpXG4gICAgICBjb25zdCByZWdpb24gPSB4bWxQYXJzZXJzLnBhcnNlQnVja2V0UmVnaW9uKGJvZHkpIHx8IERFRkFVTFRfUkVHSU9OXG4gICAgICB0aGlzLnJlZ2lvbk1hcFtidWNrZXROYW1lXSA9IHJlZ2lvblxuICAgICAgcmV0dXJuIHJlZ2lvblxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAnbG9jYXRpb24nXG4gICAgLy8gYGdldEJ1Y2tldExvY2F0aW9uYCBiZWhhdmVzIGRpZmZlcmVudGx5IGluIGZvbGxvd2luZyB3YXlzIGZvclxuICAgIC8vIGRpZmZlcmVudCBlbnZpcm9ubWVudHMuXG4gICAgLy9cbiAgICAvLyAtIEZvciBub2RlanMgZW52IHdlIGRlZmF1bHQgdG8gcGF0aCBzdHlsZSByZXF1ZXN0cy5cbiAgICAvLyAtIEZvciBicm93c2VyIGVudiBwYXRoIHN0eWxlIHJlcXVlc3RzIG9uIGJ1Y2tldHMgeWllbGRzIENPUlNcbiAgICAvLyAgIGVycm9yLiBUbyBjaXJjdW12ZW50IHRoaXMgcHJvYmxlbSB3ZSBtYWtlIGEgdmlydHVhbCBob3N0XG4gICAgLy8gICBzdHlsZSByZXF1ZXN0IHNpZ25lZCB3aXRoICd1cy1lYXN0LTEnLiBUaGlzIHJlcXVlc3QgZmFpbHNcbiAgICAvLyAgIHdpdGggYW4gZXJyb3IgJ0F1dGhvcml6YXRpb25IZWFkZXJNYWxmb3JtZWQnLCBhZGRpdGlvbmFsbHlcbiAgICAvLyAgIHRoZSBlcnJvciBYTUwgYWxzbyBwcm92aWRlcyBSZWdpb24gb2YgdGhlIGJ1Y2tldC4gVG8gdmFsaWRhdGVcbiAgICAvLyAgIHRoaXMgcmVnaW9uIGlzIHByb3BlciB3ZSByZXRyeSB0aGUgc2FtZSByZXF1ZXN0IHdpdGggdGhlIG5ld2x5XG4gICAgLy8gICBvYnRhaW5lZCByZWdpb24uXG4gICAgY29uc3QgcGF0aFN0eWxlID0gdGhpcy5wYXRoU3R5bGUgJiYgIWlzQnJvd3NlclxuICAgIGxldCByZWdpb246IHN0cmluZ1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBwYXRoU3R5bGUgfSwgJycsIFsyMDBdLCBERUZBVUxUX1JFR0lPTilcbiAgICAgIHJldHVybiBleHRyYWN0UmVnaW9uQXN5bmMocmVzKVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIC8vIG1ha2UgYWxpZ25tZW50IHdpdGggbWMgY2xpXG4gICAgICBpZiAoZSBpbnN0YW5jZW9mIGVycm9ycy5TM0Vycm9yKSB7XG4gICAgICAgIGNvbnN0IGVyckNvZGUgPSBlLmNvZGVcbiAgICAgICAgY29uc3QgZXJyUmVnaW9uID0gZS5yZWdpb25cbiAgICAgICAgaWYgKGVyckNvZGUgPT09ICdBY2Nlc3NEZW5pZWQnICYmICFlcnJSZWdpb24pIHtcbiAgICAgICAgICByZXR1cm4gREVGQVVMVF9SRUdJT05cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgaWYgKCEoZS5uYW1lID09PSAnQXV0aG9yaXphdGlvbkhlYWRlck1hbGZvcm1lZCcpKSB7XG4gICAgICAgIHRocm93IGVcbiAgICAgIH1cbiAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3Igd2Ugc2V0IGV4dHJhIHByb3BlcnRpZXMgb24gZXJyb3Igb2JqZWN0XG4gICAgICByZWdpb24gPSBlLlJlZ2lvbiBhcyBzdHJpbmdcbiAgICAgIGlmICghcmVnaW9uKSB7XG4gICAgICAgIHRocm93IGVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBwYXRoU3R5bGUgfSwgJycsIFsyMDBdLCByZWdpb24pXG4gICAgcmV0dXJuIGF3YWl0IGV4dHJhY3RSZWdpb25Bc3luYyhyZXMpXG4gIH1cblxuICAvKipcbiAgICogbWFrZVJlcXVlc3QgaXMgdGhlIHByaW1pdGl2ZSB1c2VkIGJ5IHRoZSBhcGlzIGZvciBtYWtpbmcgUzMgcmVxdWVzdHMuXG4gICAqIHBheWxvYWQgY2FuIGJlIGVtcHR5IHN0cmluZyBpbiBjYXNlIG9mIG5vIHBheWxvYWQuXG4gICAqIHN0YXR1c0NvZGUgaXMgdGhlIGV4cGVjdGVkIHN0YXR1c0NvZGUuIElmIHJlc3BvbnNlLnN0YXR1c0NvZGUgZG9lcyBub3QgbWF0Y2hcbiAgICogd2UgcGFyc2UgdGhlIFhNTCBlcnJvciBhbmQgY2FsbCB0aGUgY2FsbGJhY2sgd2l0aCB0aGUgZXJyb3IgbWVzc2FnZS5cbiAgICogQSB2YWxpZCByZWdpb24gaXMgcGFzc2VkIGJ5IHRoZSBjYWxscyAtIGxpc3RCdWNrZXRzLCBtYWtlQnVja2V0IGFuZFxuICAgKiBnZXRCdWNrZXRSZWdpb24uXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIHVzZSBgbWFrZVJlcXVlc3RBc3luY2AgaW5zdGVhZFxuICAgKi9cbiAgbWFrZVJlcXVlc3QoXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcbiAgICBwYXlsb2FkOiBCaW5hcnkgPSAnJyxcbiAgICBleHBlY3RlZENvZGVzOiBudW1iZXJbXSA9IFsyMDBdLFxuICAgIHJlZ2lvbiA9ICcnLFxuICAgIHJldHVyblJlc3BvbnNlOiBib29sZWFuLFxuICAgIGNiOiAoY2I6IHVua25vd24sIHJlc3VsdDogaHR0cC5JbmNvbWluZ01lc3NhZ2UpID0+IHZvaWQsXG4gICkge1xuICAgIGxldCBwcm9tOiBQcm9taXNlPGh0dHAuSW5jb21pbmdNZXNzYWdlPlxuICAgIGlmIChyZXR1cm5SZXNwb25zZSkge1xuICAgICAgcHJvbSA9IHRoaXMubWFrZVJlcXVlc3RBc3luYyhvcHRpb25zLCBwYXlsb2FkLCBleHBlY3RlZENvZGVzLCByZWdpb24pXG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgY29tcGF0aWJsZSBmb3Igb2xkIGJlaGF2aW91clxuICAgICAgcHJvbSA9IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQob3B0aW9ucywgcGF5bG9hZCwgZXhwZWN0ZWRDb2RlcywgcmVnaW9uKVxuICAgIH1cblxuICAgIHByb20udGhlbihcbiAgICAgIChyZXN1bHQpID0+IGNiKG51bGwsIHJlc3VsdCksXG4gICAgICAoZXJyKSA9PiB7XG4gICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICBjYihlcnIpXG4gICAgICB9LFxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBtYWtlUmVxdWVzdFN0cmVhbSB3aWxsIGJlIHVzZWQgZGlyZWN0bHkgaW5zdGVhZCBvZiBtYWtlUmVxdWVzdCBpbiBjYXNlIHRoZSBwYXlsb2FkXG4gICAqIGlzIGF2YWlsYWJsZSBhcyBhIHN0cmVhbS4gZm9yIGV4LiBwdXRPYmplY3RcbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgdXNlIGBtYWtlUmVxdWVzdFN0cmVhbUFzeW5jYCBpbnN0ZWFkXG4gICAqL1xuICBtYWtlUmVxdWVzdFN0cmVhbShcbiAgICBvcHRpb25zOiBSZXF1ZXN0T3B0aW9uLFxuICAgIHN0cmVhbTogc3RyZWFtLlJlYWRhYmxlIHwgQnVmZmVyLFxuICAgIHNoYTI1NnN1bTogc3RyaW5nLFxuICAgIHN0YXR1c0NvZGVzOiBudW1iZXJbXSxcbiAgICByZWdpb246IHN0cmluZyxcbiAgICByZXR1cm5SZXNwb25zZTogYm9vbGVhbixcbiAgICBjYjogKGNiOiB1bmtub3duLCByZXN1bHQ6IGh0dHAuSW5jb21pbmdNZXNzYWdlKSA9PiB2b2lkLFxuICApIHtcbiAgICBjb25zdCBleGVjdXRvciA9IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RTdHJlYW1Bc3luYyhvcHRpb25zLCBzdHJlYW0sIHNoYTI1NnN1bSwgc3RhdHVzQ29kZXMsIHJlZ2lvbilcbiAgICAgIGlmICghcmV0dXJuUmVzcG9uc2UpIHtcbiAgICAgICAgYXdhaXQgZHJhaW5SZXNwb25zZShyZXMpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXNcbiAgICB9XG5cbiAgICBleGVjdXRvcigpLnRoZW4oXG4gICAgICAocmVzdWx0KSA9PiBjYihudWxsLCByZXN1bHQpLFxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgKGVycikgPT4gY2IoZXJyKSxcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogQGRlcHJlY2F0ZWQgdXNlIGBnZXRCdWNrZXRSZWdpb25Bc3luY2AgaW5zdGVhZFxuICAgKi9cbiAgZ2V0QnVja2V0UmVnaW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgY2I6IChlcnI6IHVua25vd24sIHJlZ2lvbjogc3RyaW5nKSA9PiB2b2lkKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QnVja2V0UmVnaW9uQXN5bmMoYnVja2V0TmFtZSkudGhlbihcbiAgICAgIChyZXN1bHQpID0+IGNiKG51bGwsIHJlc3VsdCksXG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAoZXJyKSA9PiBjYihlcnIpLFxuICAgIClcbiAgfVxuXG4gIC8vIEJ1Y2tldCBvcGVyYXRpb25zXG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgdGhlIGJ1Y2tldCBgYnVja2V0TmFtZWAuXG4gICAqXG4gICAqL1xuICBhc3luYyBtYWtlQnVja2V0KGJ1Y2tldE5hbWU6IHN0cmluZywgcmVnaW9uOiBSZWdpb24gPSAnJywgbWFrZU9wdHM/OiBNYWtlQnVja2V0T3B0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgLy8gQmFja3dhcmQgQ29tcGF0aWJpbGl0eVxuICAgIGlmIChpc09iamVjdChyZWdpb24pKSB7XG4gICAgICBtYWtlT3B0cyA9IHJlZ2lvblxuICAgICAgcmVnaW9uID0gJydcbiAgICB9XG5cbiAgICBpZiAoIWlzU3RyaW5nKHJlZ2lvbikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlZ2lvbiBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKG1ha2VPcHRzICYmICFpc09iamVjdChtYWtlT3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21ha2VPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIGxldCBwYXlsb2FkID0gJydcblxuICAgIC8vIFJlZ2lvbiBhbHJlYWR5IHNldCBpbiBjb25zdHJ1Y3RvciwgdmFsaWRhdGUgaWZcbiAgICAvLyBjYWxsZXIgcmVxdWVzdGVkIGJ1Y2tldCBsb2NhdGlvbiBpcyBzYW1lLlxuICAgIGlmIChyZWdpb24gJiYgdGhpcy5yZWdpb24pIHtcbiAgICAgIGlmIChyZWdpb24gIT09IHRoaXMucmVnaW9uKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYENvbmZpZ3VyZWQgcmVnaW9uICR7dGhpcy5yZWdpb259LCByZXF1ZXN0ZWQgJHtyZWdpb259YClcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gc2VuZGluZyBtYWtlQnVja2V0IHJlcXVlc3Qgd2l0aCBYTUwgY29udGFpbmluZyAndXMtZWFzdC0xJyBmYWlscy4gRm9yXG4gICAgLy8gZGVmYXVsdCByZWdpb24gc2VydmVyIGV4cGVjdHMgdGhlIHJlcXVlc3Qgd2l0aG91dCBib2R5XG4gICAgaWYgKHJlZ2lvbiAmJiByZWdpb24gIT09IERFRkFVTFRfUkVHSU9OKSB7XG4gICAgICBwYXlsb2FkID0geG1sLmJ1aWxkT2JqZWN0KHtcbiAgICAgICAgQ3JlYXRlQnVja2V0Q29uZmlndXJhdGlvbjoge1xuICAgICAgICAgICQ6IHsgeG1sbnM6ICdodHRwOi8vczMuYW1hem9uYXdzLmNvbS9kb2MvMjAwNi0wMy0wMS8nIH0sXG4gICAgICAgICAgTG9jYXRpb25Db25zdHJhaW50OiByZWdpb24sXG4gICAgICAgIH0sXG4gICAgICB9KVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cblxuICAgIGlmIChtYWtlT3B0cyAmJiBtYWtlT3B0cy5PYmplY3RMb2NraW5nKSB7XG4gICAgICBoZWFkZXJzWyd4LWFtei1idWNrZXQtb2JqZWN0LWxvY2stZW5hYmxlZCddID0gdHJ1ZVxuICAgIH1cblxuICAgIC8vIEZvciBjdXN0b20gcmVnaW9uIGNsaWVudHMgIGRlZmF1bHQgdG8gY3VzdG9tIHJlZ2lvbiBzcGVjaWZpZWQgaW4gY2xpZW50IGNvbnN0cnVjdG9yXG4gICAgY29uc3QgZmluYWxSZWdpb24gPSB0aGlzLnJlZ2lvbiB8fCByZWdpb24gfHwgREVGQVVMVF9SRUdJT05cblxuICAgIGNvbnN0IHJlcXVlc3RPcHQ6IFJlcXVlc3RPcHRpb24gPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgaGVhZGVycyB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdChyZXF1ZXN0T3B0LCBwYXlsb2FkLCBbMjAwXSwgZmluYWxSZWdpb24pXG4gICAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XG4gICAgICBpZiAocmVnaW9uID09PSAnJyB8fCByZWdpb24gPT09IERFRkFVTFRfUkVHSU9OKSB7XG4gICAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBlcnJvcnMuUzNFcnJvcikge1xuICAgICAgICAgIGNvbnN0IGVyckNvZGUgPSBlcnIuY29kZVxuICAgICAgICAgIGNvbnN0IGVyclJlZ2lvbiA9IGVyci5yZWdpb25cbiAgICAgICAgICBpZiAoZXJyQ29kZSA9PT0gJ0F1dGhvcml6YXRpb25IZWFkZXJNYWxmb3JtZWQnICYmIGVyclJlZ2lvbiAhPT0gJycpIHtcbiAgICAgICAgICAgIC8vIFJldHJ5IHdpdGggcmVnaW9uIHJldHVybmVkIGFzIHBhcnQgb2YgZXJyb3JcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQocmVxdWVzdE9wdCwgcGF5bG9hZCwgWzIwMF0sIGVyckNvZGUpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVG8gY2hlY2sgaWYgYSBidWNrZXQgYWxyZWFkeSBleGlzdHMuXG4gICAqL1xuICBhc3luYyBidWNrZXRFeGlzdHMoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0hFQUQnXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUgfSlcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgIGlmIChlcnIuY29kZSA9PT0gJ05vU3VjaEJ1Y2tldCcgfHwgZXJyLmNvZGUgPT09ICdOb3RGb3VuZCcpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgYXN5bmMgcmVtb3ZlQnVja2V0KGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD5cblxuICAvKipcbiAgICogQGRlcHJlY2F0ZWQgdXNlIHByb21pc2Ugc3R5bGUgQVBJXG4gICAqL1xuICByZW1vdmVCdWNrZXQoYnVja2V0TmFtZTogc3RyaW5nLCBjYWxsYmFjazogTm9SZXN1bHRDYWxsYmFjayk6IHZvaWRcblxuICBhc3luYyByZW1vdmVCdWNrZXQoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lIH0sICcnLCBbMjA0XSlcbiAgICBkZWxldGUgdGhpcy5yZWdpb25NYXBbYnVja2V0TmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsYmFjayBpcyBjYWxsZWQgd2l0aCByZWFkYWJsZSBzdHJlYW0gb2YgdGhlIG9iamVjdCBjb250ZW50LlxuICAgKi9cbiAgYXN5bmMgZ2V0T2JqZWN0KGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBnZXRPcHRzPzogR2V0T2JqZWN0T3B0cyk6IFByb21pc2U8c3RyZWFtLlJlYWRhYmxlPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuZ2V0UGFydGlhbE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCAwLCAwLCBnZXRPcHRzKVxuICB9XG5cbiAgLyoqXG4gICAqIENhbGxiYWNrIGlzIGNhbGxlZCB3aXRoIHJlYWRhYmxlIHN0cmVhbSBvZiB0aGUgcGFydGlhbCBvYmplY3QgY29udGVudC5cbiAgICogQHBhcmFtIGJ1Y2tldE5hbWVcbiAgICogQHBhcmFtIG9iamVjdE5hbWVcbiAgICogQHBhcmFtIG9mZnNldFxuICAgKiBAcGFyYW0gbGVuZ3RoIC0gbGVuZ3RoIG9mIHRoZSBvYmplY3QgdGhhdCB3aWxsIGJlIHJlYWQgaW4gdGhlIHN0cmVhbSAob3B0aW9uYWwsIGlmIG5vdCBzcGVjaWZpZWQgd2UgcmVhZCB0aGUgcmVzdCBvZiB0aGUgZmlsZSBmcm9tIHRoZSBvZmZzZXQpXG4gICAqIEBwYXJhbSBnZXRPcHRzXG4gICAqL1xuICBhc3luYyBnZXRQYXJ0aWFsT2JqZWN0KFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgb2Zmc2V0OiBudW1iZXIsXG4gICAgbGVuZ3RoID0gMCxcbiAgICBnZXRPcHRzPzogR2V0T2JqZWN0T3B0cyxcbiAgKTogUHJvbWlzZTxzdHJlYW0uUmVhZGFibGU+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzTnVtYmVyKG9mZnNldCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29mZnNldCBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICB9XG4gICAgaWYgKCFpc051bWJlcihsZW5ndGgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsZW5ndGggc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuXG4gICAgbGV0IHJhbmdlID0gJydcbiAgICBpZiAob2Zmc2V0IHx8IGxlbmd0aCkge1xuICAgICAgaWYgKG9mZnNldCkge1xuICAgICAgICByYW5nZSA9IGBieXRlcz0keytvZmZzZXR9LWBcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJhbmdlID0gJ2J5dGVzPTAtJ1xuICAgICAgICBvZmZzZXQgPSAwXG4gICAgICB9XG4gICAgICBpZiAobGVuZ3RoKSB7XG4gICAgICAgIHJhbmdlICs9IGAkeytsZW5ndGggKyBvZmZzZXQgLSAxfWBcbiAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgcXVlcnkgPSAnJ1xuICAgIGxldCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHtcbiAgICAgIC4uLihyYW5nZSAhPT0gJycgJiYgeyByYW5nZSB9KSxcbiAgICB9XG5cbiAgICBpZiAoZ2V0T3B0cykge1xuICAgICAgY29uc3Qgc3NlSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAgICAgLi4uKGdldE9wdHMuU1NFQ3VzdG9tZXJBbGdvcml0aG0gJiYge1xuICAgICAgICAgICdYLUFtei1TZXJ2ZXItU2lkZS1FbmNyeXB0aW9uLUN1c3RvbWVyLUFsZ29yaXRobSc6IGdldE9wdHMuU1NFQ3VzdG9tZXJBbGdvcml0aG0sXG4gICAgICAgIH0pLFxuICAgICAgICAuLi4oZ2V0T3B0cy5TU0VDdXN0b21lcktleSAmJiB7ICdYLUFtei1TZXJ2ZXItU2lkZS1FbmNyeXB0aW9uLUN1c3RvbWVyLUtleSc6IGdldE9wdHMuU1NFQ3VzdG9tZXJLZXkgfSksXG4gICAgICAgIC4uLihnZXRPcHRzLlNTRUN1c3RvbWVyS2V5TUQ1ICYmIHtcbiAgICAgICAgICAnWC1BbXotU2VydmVyLVNpZGUtRW5jcnlwdGlvbi1DdXN0b21lci1LZXktTUQ1JzogZ2V0T3B0cy5TU0VDdXN0b21lcktleU1ENSxcbiAgICAgICAgfSksXG4gICAgICB9XG4gICAgICBxdWVyeSA9IHFzLnN0cmluZ2lmeShnZXRPcHRzKVxuICAgICAgaGVhZGVycyA9IHtcbiAgICAgICAgLi4ucHJlcGVuZFhBTVpNZXRhKHNzZUhlYWRlcnMpLFxuICAgICAgICAuLi5oZWFkZXJzLFxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGV4cGVjdGVkU3RhdHVzQ29kZXMgPSBbMjAwXVxuICAgIGlmIChyYW5nZSkge1xuICAgICAgZXhwZWN0ZWRTdGF0dXNDb2Rlcy5wdXNoKDIwNilcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMsIHF1ZXJ5IH0sICcnLCBleHBlY3RlZFN0YXR1c0NvZGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIGRvd25sb2FkIG9iamVjdCBjb250ZW50IHRvIGEgZmlsZS5cbiAgICogVGhpcyBtZXRob2Qgd2lsbCBjcmVhdGUgYSB0ZW1wIGZpbGUgbmFtZWQgYCR7ZmlsZW5hbWV9LiR7YmFzZTY0KGV0YWcpfS5wYXJ0Lm1pbmlvYCB3aGVuIGRvd25sb2FkaW5nLlxuICAgKlxuICAgKiBAcGFyYW0gYnVja2V0TmFtZSAtIG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAgKiBAcGFyYW0gb2JqZWN0TmFtZSAtIG5hbWUgb2YgdGhlIG9iamVjdFxuICAgKiBAcGFyYW0gZmlsZVBhdGggLSBwYXRoIHRvIHdoaWNoIHRoZSBvYmplY3QgZGF0YSB3aWxsIGJlIHdyaXR0ZW4gdG9cbiAgICogQHBhcmFtIGdldE9wdHMgLSBPcHRpb25hbCBvYmplY3QgZ2V0IG9wdGlvblxuICAgKi9cbiAgYXN5bmMgZkdldE9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgZ2V0T3B0cz86IEdldE9iamVjdE9wdHMpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBJbnB1dCB2YWxpZGF0aW9uLlxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoZmlsZVBhdGgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdmaWxlUGF0aCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG5cbiAgICBjb25zdCBkb3dubG9hZFRvVG1wRmlsZSA9IGFzeW5jICgpOiBQcm9taXNlPHN0cmluZz4gPT4ge1xuICAgICAgbGV0IHBhcnRGaWxlU3RyZWFtOiBzdHJlYW0uV3JpdGFibGVcbiAgICAgIGNvbnN0IG9ialN0YXQgPSBhd2FpdCB0aGlzLnN0YXRPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZ2V0T3B0cylcbiAgICAgIGNvbnN0IGVuY29kZWRFdGFnID0gQnVmZmVyLmZyb20ob2JqU3RhdC5ldGFnKS50b1N0cmluZygnYmFzZTY0JylcbiAgICAgIGNvbnN0IHBhcnRGaWxlID0gYCR7ZmlsZVBhdGh9LiR7ZW5jb2RlZEV0YWd9LnBhcnQubWluaW9gXG5cbiAgICAgIGF3YWl0IGZzcC5ta2RpcihwYXRoLmRpcm5hbWUoZmlsZVBhdGgpLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KVxuXG4gICAgICBsZXQgb2Zmc2V0ID0gMFxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmc3Auc3RhdChwYXJ0RmlsZSlcbiAgICAgICAgaWYgKG9ialN0YXQuc2l6ZSA9PT0gc3RhdHMuc2l6ZSkge1xuICAgICAgICAgIHJldHVybiBwYXJ0RmlsZVxuICAgICAgICB9XG4gICAgICAgIG9mZnNldCA9IHN0YXRzLnNpemVcbiAgICAgICAgcGFydEZpbGVTdHJlYW0gPSBmcy5jcmVhdGVXcml0ZVN0cmVhbShwYXJ0RmlsZSwgeyBmbGFnczogJ2EnIH0pXG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGlmIChlIGluc3RhbmNlb2YgRXJyb3IgJiYgKGUgYXMgdW5rbm93biBhcyB7IGNvZGU6IHN0cmluZyB9KS5jb2RlID09PSAnRU5PRU5UJykge1xuICAgICAgICAgIC8vIGZpbGUgbm90IGV4aXN0XG4gICAgICAgICAgcGFydEZpbGVTdHJlYW0gPSBmcy5jcmVhdGVXcml0ZVN0cmVhbShwYXJ0RmlsZSwgeyBmbGFnczogJ3cnIH0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gb3RoZXIgZXJyb3IsIG1heWJlIGFjY2VzcyBkZW55XG4gICAgICAgICAgdGhyb3cgZVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGRvd25sb2FkU3RyZWFtID0gYXdhaXQgdGhpcy5nZXRQYXJ0aWFsT2JqZWN0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIG9mZnNldCwgMCwgZ2V0T3B0cylcblxuICAgICAgYXdhaXQgc3RyZWFtUHJvbWlzZS5waXBlbGluZShkb3dubG9hZFN0cmVhbSwgcGFydEZpbGVTdHJlYW0pXG4gICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzcC5zdGF0KHBhcnRGaWxlKVxuICAgICAgaWYgKHN0YXRzLnNpemUgPT09IG9ialN0YXQuc2l6ZSkge1xuICAgICAgICByZXR1cm4gcGFydEZpbGVcbiAgICAgIH1cblxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdTaXplIG1pc21hdGNoIGJldHdlZW4gZG93bmxvYWRlZCBmaWxlIGFuZCB0aGUgb2JqZWN0JylcbiAgICB9XG5cbiAgICBjb25zdCBwYXJ0RmlsZSA9IGF3YWl0IGRvd25sb2FkVG9UbXBGaWxlKClcbiAgICBhd2FpdCBmc3AucmVuYW1lKHBhcnRGaWxlLCBmaWxlUGF0aClcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGF0IGluZm9ybWF0aW9uIG9mIHRoZSBvYmplY3QuXG4gICAqL1xuICBhc3luYyBzdGF0T2JqZWN0KGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBzdGF0T3B0cz86IFN0YXRPYmplY3RPcHRzKTogUHJvbWlzZTxCdWNrZXRJdGVtU3RhdD4ge1xuICAgIGNvbnN0IHN0YXRPcHREZWYgPSBzdGF0T3B0cyB8fCB7fVxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKCFpc09iamVjdChzdGF0T3B0RGVmKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignc3RhdE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuXG4gICAgY29uc3QgcXVlcnkgPSBxcy5zdHJpbmdpZnkoc3RhdE9wdERlZilcbiAgICBjb25zdCBtZXRob2QgPSAnSEVBRCdcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9KVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHNpemU6IHBhcnNlSW50KHJlcy5oZWFkZXJzWydjb250ZW50LWxlbmd0aCddIGFzIHN0cmluZyksXG4gICAgICBtZXRhRGF0YTogZXh0cmFjdE1ldGFkYXRhKHJlcy5oZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcbiAgICAgIGxhc3RNb2RpZmllZDogbmV3IERhdGUocmVzLmhlYWRlcnNbJ2xhc3QtbW9kaWZpZWQnXSBhcyBzdHJpbmcpLFxuICAgICAgdmVyc2lvbklkOiBnZXRWZXJzaW9uSWQocmVzLmhlYWRlcnMgYXMgUmVzcG9uc2VIZWFkZXIpLFxuICAgICAgZXRhZzogc2FuaXRpemVFVGFnKHJlcy5oZWFkZXJzLmV0YWcpLFxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHJlbW92ZU9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgcmVtb3ZlT3B0cz86IFJlbW92ZU9wdGlvbnMpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGlmIChyZW1vdmVPcHRzICYmICFpc09iamVjdChyZW1vdmVPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigncmVtb3ZlT3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxuICAgIGlmIChyZW1vdmVPcHRzPy5nb3Zlcm5hbmNlQnlwYXNzKSB7XG4gICAgICBoZWFkZXJzWydYLUFtei1CeXBhc3MtR292ZXJuYW5jZS1SZXRlbnRpb24nXSA9IHRydWVcbiAgICB9XG4gICAgaWYgKHJlbW92ZU9wdHM/LmZvcmNlRGVsZXRlKSB7XG4gICAgICBoZWFkZXJzWyd4LW1pbmlvLWZvcmNlLWRlbGV0ZSddID0gdHJ1ZVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5UGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge31cbiAgICBpZiAocmVtb3ZlT3B0cz8udmVyc2lvbklkKSB7XG4gICAgICBxdWVyeVBhcmFtcy52ZXJzaW9uSWQgPSBgJHtyZW1vdmVPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuICAgIGNvbnN0IHF1ZXJ5ID0gcXMuc3RyaW5naWZ5KHF1ZXJ5UGFyYW1zKVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycywgcXVlcnkgfSwgJycsIFsyMDAsIDIwNF0pXG4gIH1cblxuICAvLyBDYWxscyBpbXBsZW1lbnRlZCBiZWxvdyBhcmUgcmVsYXRlZCB0byBtdWx0aXBhcnQuXG5cbiAgbGlzdEluY29tcGxldGVVcGxvYWRzKFxuICAgIGJ1Y2tldDogc3RyaW5nLFxuICAgIHByZWZpeDogc3RyaW5nLFxuICAgIHJlY3Vyc2l2ZTogYm9vbGVhbixcbiAgKTogQnVja2V0U3RyZWFtPEluY29tcGxldGVVcGxvYWRlZEJ1Y2tldEl0ZW0+IHtcbiAgICBpZiAocHJlZml4ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHByZWZpeCA9ICcnXG4gICAgfVxuICAgIGlmIChyZWN1cnNpdmUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmVjdXJzaXZlID0gZmFsc2VcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXQpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXQpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZFByZWZpeChwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRQcmVmaXhFcnJvcihgSW52YWxpZCBwcmVmaXggOiAke3ByZWZpeH1gKVxuICAgIH1cbiAgICBpZiAoIWlzQm9vbGVhbihyZWN1cnNpdmUpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWN1cnNpdmUgc2hvdWxkIGJlIG9mIHR5cGUgXCJib29sZWFuXCInKVxuICAgIH1cbiAgICBjb25zdCBkZWxpbWl0ZXIgPSByZWN1cnNpdmUgPyAnJyA6ICcvJ1xuICAgIGxldCBrZXlNYXJrZXIgPSAnJ1xuICAgIGxldCB1cGxvYWRJZE1hcmtlciA9ICcnXG4gICAgY29uc3QgdXBsb2FkczogdW5rbm93bltdID0gW11cbiAgICBsZXQgZW5kZWQgPSBmYWxzZVxuXG4gICAgLy8gVE9ETzogcmVmYWN0b3IgdGhpcyB3aXRoIGFzeW5jL2F3YWl0IGFuZCBgc3RyZWFtLlJlYWRhYmxlLmZyb21gXG4gICAgY29uc3QgcmVhZFN0cmVhbSA9IG5ldyBzdHJlYW0uUmVhZGFibGUoeyBvYmplY3RNb2RlOiB0cnVlIH0pXG4gICAgcmVhZFN0cmVhbS5fcmVhZCA9ICgpID0+IHtcbiAgICAgIC8vIHB1c2ggb25lIHVwbG9hZCBpbmZvIHBlciBfcmVhZCgpXG4gICAgICBpZiAodXBsb2Fkcy5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIHJlYWRTdHJlYW0ucHVzaCh1cGxvYWRzLnNoaWZ0KCkpXG4gICAgICB9XG4gICAgICBpZiAoZW5kZWQpIHtcbiAgICAgICAgcmV0dXJuIHJlYWRTdHJlYW0ucHVzaChudWxsKVxuICAgICAgfVxuICAgICAgdGhpcy5saXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeShidWNrZXQsIHByZWZpeCwga2V5TWFya2VyLCB1cGxvYWRJZE1hcmtlciwgZGVsaW1pdGVyKS50aGVuKFxuICAgICAgICAocmVzdWx0KSA9PiB7XG4gICAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICByZXN1bHQucHJlZml4ZXMuZm9yRWFjaCgocHJlZml4KSA9PiB1cGxvYWRzLnB1c2gocHJlZml4KSlcbiAgICAgICAgICBhc3luYy5lYWNoU2VyaWVzKFxuICAgICAgICAgICAgcmVzdWx0LnVwbG9hZHMsXG4gICAgICAgICAgICAodXBsb2FkLCBjYikgPT4ge1xuICAgICAgICAgICAgICAvLyBmb3IgZWFjaCBpbmNvbXBsZXRlIHVwbG9hZCBhZGQgdGhlIHNpemVzIG9mIGl0cyB1cGxvYWRlZCBwYXJ0c1xuICAgICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICAgICAgdGhpcy5saXN0UGFydHMoYnVja2V0LCB1cGxvYWQua2V5LCB1cGxvYWQudXBsb2FkSWQpLnRoZW4oXG4gICAgICAgICAgICAgICAgKHBhcnRzOiBQYXJ0W10pID0+IHtcbiAgICAgICAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgICAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICAgICAgICAgIHVwbG9hZC5zaXplID0gcGFydHMucmVkdWNlKChhY2MsIGl0ZW0pID0+IGFjYyArIGl0ZW0uc2l6ZSwgMClcbiAgICAgICAgICAgICAgICAgIHVwbG9hZHMucHVzaCh1cGxvYWQpXG4gICAgICAgICAgICAgICAgICBjYigpXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAoZXJyOiBFcnJvcikgPT4gY2IoZXJyKSxcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIChlcnIpID0+IHtcbiAgICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICAgIHJlYWRTdHJlYW0uZW1pdCgnZXJyb3InLCBlcnIpXG4gICAgICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgaWYgKHJlc3VsdC5pc1RydW5jYXRlZCkge1xuICAgICAgICAgICAgICAgIGtleU1hcmtlciA9IHJlc3VsdC5uZXh0S2V5TWFya2VyXG4gICAgICAgICAgICAgICAgdXBsb2FkSWRNYXJrZXIgPSByZXN1bHQubmV4dFVwbG9hZElkTWFya2VyXG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZW5kZWQgPSB0cnVlXG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICAgICAgcmVhZFN0cmVhbS5fcmVhZCgpXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIClcbiAgICAgICAgfSxcbiAgICAgICAgKGUpID0+IHtcbiAgICAgICAgICByZWFkU3RyZWFtLmVtaXQoJ2Vycm9yJywgZSlcbiAgICAgICAgfSxcbiAgICAgIClcbiAgICB9XG4gICAgcmV0dXJuIHJlYWRTdHJlYW1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsZWQgYnkgbGlzdEluY29tcGxldGVVcGxvYWRzIHRvIGZldGNoIGEgYmF0Y2ggb2YgaW5jb21wbGV0ZSB1cGxvYWRzLlxuICAgKi9cbiAgYXN5bmMgbGlzdEluY29tcGxldGVVcGxvYWRzUXVlcnkoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIHByZWZpeDogc3RyaW5nLFxuICAgIGtleU1hcmtlcjogc3RyaW5nLFxuICAgIHVwbG9hZElkTWFya2VyOiBzdHJpbmcsXG4gICAgZGVsaW1pdGVyOiBzdHJpbmcsXG4gICk6IFByb21pc2U8TGlzdE11bHRpcGFydFJlc3VsdD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKGtleU1hcmtlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2tleU1hcmtlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyh1cGxvYWRJZE1hcmtlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3VwbG9hZElkTWFya2VyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKGRlbGltaXRlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2RlbGltaXRlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgY29uc3QgcXVlcmllcyA9IFtdXG4gICAgcXVlcmllcy5wdXNoKGBwcmVmaXg9JHt1cmlFc2NhcGUocHJlZml4KX1gKVxuICAgIHF1ZXJpZXMucHVzaChgZGVsaW1pdGVyPSR7dXJpRXNjYXBlKGRlbGltaXRlcil9YClcblxuICAgIGlmIChrZXlNYXJrZXIpIHtcbiAgICAgIHF1ZXJpZXMucHVzaChga2V5LW1hcmtlcj0ke3VyaUVzY2FwZShrZXlNYXJrZXIpfWApXG4gICAgfVxuICAgIGlmICh1cGxvYWRJZE1hcmtlcikge1xuICAgICAgcXVlcmllcy5wdXNoKGB1cGxvYWQtaWQtbWFya2VyPSR7dXBsb2FkSWRNYXJrZXJ9YClcbiAgICB9XG5cbiAgICBjb25zdCBtYXhVcGxvYWRzID0gMTAwMFxuICAgIHF1ZXJpZXMucHVzaChgbWF4LXVwbG9hZHM9JHttYXhVcGxvYWRzfWApXG4gICAgcXVlcmllcy5zb3J0KClcbiAgICBxdWVyaWVzLnVuc2hpZnQoJ3VwbG9hZHMnKVxuICAgIGxldCBxdWVyeSA9ICcnXG4gICAgaWYgKHF1ZXJpZXMubGVuZ3RoID4gMCkge1xuICAgICAgcXVlcnkgPSBgJHtxdWVyaWVzLmpvaW4oJyYnKX1gXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlTGlzdE11bHRpcGFydChib2R5KVxuICB9XG5cbiAgLyoqXG4gICAqIEluaXRpYXRlIGEgbmV3IG11bHRpcGFydCB1cGxvYWQuXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgYXN5bmMgaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KGhlYWRlcnMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoJ2NvbnRlbnRUeXBlIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnUE9TVCdcbiAgICBjb25zdCBxdWVyeSA9ICd1cGxvYWRzJ1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSlcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzQnVmZmVyKHJlcylcbiAgICByZXR1cm4gcGFyc2VJbml0aWF0ZU11bHRpcGFydChib2R5LnRvU3RyaW5nKCkpXG4gIH1cblxuICAvKipcbiAgICogSW50ZXJuYWwgTWV0aG9kIHRvIGFib3J0IGEgbXVsdGlwYXJ0IHVwbG9hZCByZXF1ZXN0IGluIGNhc2Ugb2YgYW55IGVycm9ycy5cbiAgICpcbiAgICogQHBhcmFtIGJ1Y2tldE5hbWUgLSBCdWNrZXQgTmFtZVxuICAgKiBAcGFyYW0gb2JqZWN0TmFtZSAtIE9iamVjdCBOYW1lXG4gICAqIEBwYXJhbSB1cGxvYWRJZCAtIGlkIG9mIGEgbXVsdGlwYXJ0IHVwbG9hZCB0byBjYW5jZWwgZHVyaW5nIGNvbXBvc2Ugb2JqZWN0IHNlcXVlbmNlLlxuICAgKi9cbiAgYXN5bmMgYWJvcnRNdWx0aXBhcnRVcGxvYWQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHVwbG9hZElkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gYHVwbG9hZElkPSR7dXBsb2FkSWR9YFxuXG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZTogb2JqZWN0TmFtZSwgcXVlcnkgfVxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQocmVxdWVzdE9wdGlvbnMsICcnLCBbMjA0XSlcbiAgfVxuXG4gIGFzeW5jIGZpbmRVcGxvYWRJZChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBsZXQgbGF0ZXN0VXBsb2FkOiBMaXN0TXVsdGlwYXJ0UmVzdWx0Wyd1cGxvYWRzJ11bbnVtYmVyXSB8IHVuZGVmaW5lZFxuICAgIGxldCBrZXlNYXJrZXIgPSAnJ1xuICAgIGxldCB1cGxvYWRJZE1hcmtlciA9ICcnXG4gICAgZm9yICg7Oykge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5saXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeShidWNrZXROYW1lLCBvYmplY3ROYW1lLCBrZXlNYXJrZXIsIHVwbG9hZElkTWFya2VyLCAnJylcbiAgICAgIGZvciAoY29uc3QgdXBsb2FkIG9mIHJlc3VsdC51cGxvYWRzKSB7XG4gICAgICAgIGlmICh1cGxvYWQua2V5ID09PSBvYmplY3ROYW1lKSB7XG4gICAgICAgICAgaWYgKCFsYXRlc3RVcGxvYWQgfHwgdXBsb2FkLmluaXRpYXRlZC5nZXRUaW1lKCkgPiBsYXRlc3RVcGxvYWQuaW5pdGlhdGVkLmdldFRpbWUoKSkge1xuICAgICAgICAgICAgbGF0ZXN0VXBsb2FkID0gdXBsb2FkXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAocmVzdWx0LmlzVHJ1bmNhdGVkKSB7XG4gICAgICAgIGtleU1hcmtlciA9IHJlc3VsdC5uZXh0S2V5TWFya2VyXG4gICAgICAgIHVwbG9hZElkTWFya2VyID0gcmVzdWx0Lm5leHRVcGxvYWRJZE1hcmtlclxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBicmVha1xuICAgIH1cbiAgICByZXR1cm4gbGF0ZXN0VXBsb2FkPy51cGxvYWRJZFxuICB9XG5cbiAgLyoqXG4gICAqIHRoaXMgY2FsbCB3aWxsIGFnZ3JlZ2F0ZSB0aGUgcGFydHMgb24gdGhlIHNlcnZlciBpbnRvIGEgc2luZ2xlIG9iamVjdC5cbiAgICovXG4gIGFzeW5jIGNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgdXBsb2FkSWQ6IHN0cmluZyxcbiAgICBldGFnczoge1xuICAgICAgcGFydDogbnVtYmVyXG4gICAgICBldGFnPzogc3RyaW5nXG4gICAgfVtdLFxuICApOiBQcm9taXNlPHsgZXRhZzogc3RyaW5nOyB2ZXJzaW9uSWQ6IHN0cmluZyB8IG51bGwgfT4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcodXBsb2FkSWQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd1cGxvYWRJZCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChldGFncykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2V0YWdzIHNob3VsZCBiZSBvZiB0eXBlIFwiQXJyYXlcIicpXG4gICAgfVxuXG4gICAgaWYgKCF1cGxvYWRJZCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndXBsb2FkSWQgY2Fubm90IGJlIGVtcHR5JylcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUE9TVCdcbiAgICBjb25zdCBxdWVyeSA9IGB1cGxvYWRJZD0ke3VyaUVzY2FwZSh1cGxvYWRJZCl9YFxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcigpXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3Qoe1xuICAgICAgQ29tcGxldGVNdWx0aXBhcnRVcGxvYWQ6IHtcbiAgICAgICAgJDoge1xuICAgICAgICAgIHhtbG5zOiAnaHR0cDovL3MzLmFtYXpvbmF3cy5jb20vZG9jLzIwMDYtMDMtMDEvJyxcbiAgICAgICAgfSxcbiAgICAgICAgUGFydDogZXRhZ3MubWFwKChldGFnKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIFBhcnROdW1iZXI6IGV0YWcucGFydCxcbiAgICAgICAgICAgIEVUYWc6IGV0YWcuZXRhZyxcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgfSxcbiAgICB9KVxuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9LCBwYXlsb2FkKVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNCdWZmZXIocmVzKVxuICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlQ29tcGxldGVNdWx0aXBhcnQoYm9keS50b1N0cmluZygpKVxuICAgIGlmICghcmVzdWx0KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JVRzogZmFpbGVkIHRvIHBhcnNlIHNlcnZlciByZXNwb25zZScpXG4gICAgfVxuXG4gICAgaWYgKHJlc3VsdC5lcnJDb2RlKSB7XG4gICAgICAvLyBNdWx0aXBhcnQgQ29tcGxldGUgQVBJIHJldHVybnMgYW4gZXJyb3IgWE1MIGFmdGVyIGEgMjAwIGh0dHAgc3RhdHVzXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLlMzRXJyb3IocmVzdWx0LmVyck1lc3NhZ2UpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgIGV0YWc6IHJlc3VsdC5ldGFnIGFzIHN0cmluZyxcbiAgICAgIHZlcnNpb25JZDogZ2V0VmVyc2lvbklkKHJlcy5oZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR2V0IHBhcnQtaW5mbyBvZiBhbGwgcGFydHMgb2YgYW4gaW5jb21wbGV0ZSB1cGxvYWQgc3BlY2lmaWVkIGJ5IHVwbG9hZElkLlxuICAgKi9cbiAgcHJvdGVjdGVkIGFzeW5jIGxpc3RQYXJ0cyhidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgdXBsb2FkSWQ6IHN0cmluZyk6IFByb21pc2U8VXBsb2FkZWRQYXJ0W10+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHVwbG9hZElkKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndXBsb2FkSWQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghdXBsb2FkSWQpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3VwbG9hZElkIGNhbm5vdCBiZSBlbXB0eScpXG4gICAgfVxuXG4gICAgY29uc3QgcGFydHM6IFVwbG9hZGVkUGFydFtdID0gW11cbiAgICBsZXQgbWFya2VyID0gMFxuICAgIGxldCByZXN1bHRcbiAgICBkbyB7XG4gICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLmxpc3RQYXJ0c1F1ZXJ5KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHVwbG9hZElkLCBtYXJrZXIpXG4gICAgICBtYXJrZXIgPSByZXN1bHQubWFya2VyXG4gICAgICBwYXJ0cy5wdXNoKC4uLnJlc3VsdC5wYXJ0cylcbiAgICB9IHdoaWxlIChyZXN1bHQuaXNUcnVuY2F0ZWQpXG5cbiAgICByZXR1cm4gcGFydHNcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsZWQgYnkgbGlzdFBhcnRzIHRvIGZldGNoIGEgYmF0Y2ggb2YgcGFydC1pbmZvXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGxpc3RQYXJ0c1F1ZXJ5KGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCB1cGxvYWRJZDogc3RyaW5nLCBtYXJrZXI6IG51bWJlcikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcodXBsb2FkSWQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd1cGxvYWRJZCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc051bWJlcihtYXJrZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtYXJrZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuICAgIGlmICghdXBsb2FkSWQpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3VwbG9hZElkIGNhbm5vdCBiZSBlbXB0eScpXG4gICAgfVxuXG4gICAgbGV0IHF1ZXJ5ID0gYHVwbG9hZElkPSR7dXJpRXNjYXBlKHVwbG9hZElkKX1gXG4gICAgaWYgKG1hcmtlcikge1xuICAgICAgcXVlcnkgKz0gYCZwYXJ0LW51bWJlci1tYXJrZXI9JHttYXJrZXJ9YFxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9KVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlTGlzdFBhcnRzKGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpKVxuICB9XG5cbiAgYXN5bmMgbGlzdEJ1Y2tldHMoKTogUHJvbWlzZTxCdWNrZXRJdGVtRnJvbUxpc3RbXT4ge1xuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcmVnaW9uQ29uZiA9IHRoaXMucmVnaW9uIHx8IERFRkFVTFRfUkVHSU9OXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCB9LCAnJywgWzIwMF0sIHJlZ2lvbkNvbmYpXG4gICAgY29uc3QgeG1sUmVzdWx0ID0gYXdhaXQgcmVhZEFzU3RyaW5nKGh0dHBSZXMpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VMaXN0QnVja2V0KHhtbFJlc3VsdClcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxjdWxhdGUgcGFydCBzaXplIGdpdmVuIHRoZSBvYmplY3Qgc2l6ZS4gUGFydCBzaXplIHdpbGwgYmUgYXRsZWFzdCB0aGlzLnBhcnRTaXplXG4gICAqL1xuICBjYWxjdWxhdGVQYXJ0U2l6ZShzaXplOiBudW1iZXIpIHtcbiAgICBpZiAoIWlzTnVtYmVyKHNpemUpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzaXplIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cbiAgICBpZiAoc2l6ZSA+IHRoaXMubWF4T2JqZWN0U2l6ZSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgc2l6ZSBzaG91bGQgbm90IGJlIG1vcmUgdGhhbiAke3RoaXMubWF4T2JqZWN0U2l6ZX1gKVxuICAgIH1cbiAgICBpZiAodGhpcy5vdmVyUmlkZVBhcnRTaXplKSB7XG4gICAgICByZXR1cm4gdGhpcy5wYXJ0U2l6ZVxuICAgIH1cbiAgICBsZXQgcGFydFNpemUgPSB0aGlzLnBhcnRTaXplXG4gICAgZm9yICg7Oykge1xuICAgICAgLy8gd2hpbGUodHJ1ZSkgey4uLn0gdGhyb3dzIGxpbnRpbmcgZXJyb3IuXG4gICAgICAvLyBJZiBwYXJ0U2l6ZSBpcyBiaWcgZW5vdWdoIHRvIGFjY29tb2RhdGUgdGhlIG9iamVjdCBzaXplLCB0aGVuIHVzZSBpdC5cbiAgICAgIGlmIChwYXJ0U2l6ZSAqIDEwMDAwID4gc2l6ZSkge1xuICAgICAgICByZXR1cm4gcGFydFNpemVcbiAgICAgIH1cbiAgICAgIC8vIFRyeSBwYXJ0IHNpemVzIGFzIDY0TUIsIDgwTUIsIDk2TUIgZXRjLlxuICAgICAgcGFydFNpemUgKz0gMTYgKiAxMDI0ICogMTAyNFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBVcGxvYWRzIHRoZSBvYmplY3QgdXNpbmcgY29udGVudHMgZnJvbSBhIGZpbGVcbiAgICovXG4gIGFzeW5jIGZQdXRPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcsIG1ldGFEYXRhPzogT2JqZWN0TWV0YURhdGEpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGlmICghaXNTdHJpbmcoZmlsZVBhdGgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdmaWxlUGF0aCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKG1ldGFEYXRhICYmICFpc09iamVjdChtZXRhRGF0YSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21ldGFEYXRhIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIC8vIEluc2VydHMgY29ycmVjdCBgY29udGVudC10eXBlYCBhdHRyaWJ1dGUgYmFzZWQgb24gbWV0YURhdGEgYW5kIGZpbGVQYXRoXG4gICAgbWV0YURhdGEgPSBpbnNlcnRDb250ZW50VHlwZShtZXRhRGF0YSB8fCB7fSwgZmlsZVBhdGgpXG4gICAgY29uc3Qgc3RhdCA9IGF3YWl0IGZzcC5sc3RhdChmaWxlUGF0aClcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5wdXRPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZnMuY3JlYXRlUmVhZFN0cmVhbShmaWxlUGF0aCksIHN0YXQuc2l6ZSwgbWV0YURhdGEpXG4gIH1cblxuICAvKipcbiAgICogIFVwbG9hZGluZyBhIHN0cmVhbSwgXCJCdWZmZXJcIiBvciBcInN0cmluZ1wiLlxuICAgKiAgSXQncyByZWNvbW1lbmRlZCB0byBwYXNzIGBzaXplYCBhcmd1bWVudCB3aXRoIHN0cmVhbS5cbiAgICovXG4gIGFzeW5jIHB1dE9iamVjdChcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIHN0cmVhbTogc3RyZWFtLlJlYWRhYmxlIHwgQnVmZmVyIHwgc3RyaW5nLFxuICAgIHNpemU/OiBudW1iZXIsXG4gICAgbWV0YURhdGE/OiBJdGVtQnVja2V0TWV0YWRhdGEsXG4gICk6IFByb21pc2U8VXBsb2FkZWRPYmplY3RJbmZvPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICAvLyBXZSdsbCBuZWVkIHRvIHNoaWZ0IGFyZ3VtZW50cyB0byB0aGUgbGVmdCBiZWNhdXNlIG9mIG1ldGFEYXRhXG4gICAgLy8gYW5kIHNpemUgYmVpbmcgb3B0aW9uYWwuXG4gICAgaWYgKGlzT2JqZWN0KHNpemUpKSB7XG4gICAgICBtZXRhRGF0YSA9IHNpemVcbiAgICB9XG4gICAgLy8gRW5zdXJlcyBNZXRhZGF0YSBoYXMgYXBwcm9wcmlhdGUgcHJlZml4IGZvciBBMyBBUElcbiAgICBjb25zdCBoZWFkZXJzID0gcHJlcGVuZFhBTVpNZXRhKG1ldGFEYXRhKVxuICAgIGlmICh0eXBlb2Ygc3RyZWFtID09PSAnc3RyaW5nJyB8fCBzdHJlYW0gaW5zdGFuY2VvZiBCdWZmZXIpIHtcbiAgICAgIC8vIEFkYXB0cyB0aGUgbm9uLXN0cmVhbSBpbnRlcmZhY2UgaW50byBhIHN0cmVhbS5cbiAgICAgIHNpemUgPSBzdHJlYW0ubGVuZ3RoXG4gICAgICBzdHJlYW0gPSByZWFkYWJsZVN0cmVhbShzdHJlYW0pXG4gICAgfSBlbHNlIGlmICghaXNSZWFkYWJsZVN0cmVhbShzdHJlYW0pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd0aGlyZCBhcmd1bWVudCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmVhbS5SZWFkYWJsZVwiIG9yIFwiQnVmZmVyXCIgb3IgXCJzdHJpbmdcIicpXG4gICAgfVxuXG4gICAgaWYgKGlzTnVtYmVyKHNpemUpICYmIHNpemUgPCAwKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBzaXplIGNhbm5vdCBiZSBuZWdhdGl2ZSwgZ2l2ZW4gc2l6ZTogJHtzaXplfWApXG4gICAgfVxuXG4gICAgLy8gR2V0IHRoZSBwYXJ0IHNpemUgYW5kIGZvcndhcmQgdGhhdCB0byB0aGUgQmxvY2tTdHJlYW0uIERlZmF1bHQgdG8gdGhlXG4gICAgLy8gbGFyZ2VzdCBibG9jayBzaXplIHBvc3NpYmxlIGlmIG5lY2Vzc2FyeS5cbiAgICBpZiAoIWlzTnVtYmVyKHNpemUpKSB7XG4gICAgICBzaXplID0gdGhpcy5tYXhPYmplY3RTaXplXG4gICAgfVxuXG4gICAgLy8gR2V0IHRoZSBwYXJ0IHNpemUgYW5kIGZvcndhcmQgdGhhdCB0byB0aGUgQmxvY2tTdHJlYW0uIERlZmF1bHQgdG8gdGhlXG4gICAgLy8gbGFyZ2VzdCBibG9jayBzaXplIHBvc3NpYmxlIGlmIG5lY2Vzc2FyeS5cbiAgICBpZiAoc2l6ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCBzdGF0U2l6ZSA9IGF3YWl0IGdldENvbnRlbnRMZW5ndGgoc3RyZWFtKVxuICAgICAgaWYgKHN0YXRTaXplICE9PSBudWxsKSB7XG4gICAgICAgIHNpemUgPSBzdGF0U2l6ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghaXNOdW1iZXIoc2l6ZSkpIHtcbiAgICAgIC8vIEJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgIHNpemUgPSB0aGlzLm1heE9iamVjdFNpemVcbiAgICB9XG5cbiAgICBjb25zdCBwYXJ0U2l6ZSA9IHRoaXMuY2FsY3VsYXRlUGFydFNpemUoc2l6ZSlcbiAgICBpZiAodHlwZW9mIHN0cmVhbSA9PT0gJ3N0cmluZycgfHwgc3RyZWFtLnJlYWRhYmxlTGVuZ3RoID09PSAwIHx8IEJ1ZmZlci5pc0J1ZmZlcihzdHJlYW0pIHx8IHNpemUgPD0gcGFydFNpemUpIHtcbiAgICAgIGNvbnN0IGJ1ZiA9IGlzUmVhZGFibGVTdHJlYW0oc3RyZWFtKSA/IGF3YWl0IHJlYWRBc0J1ZmZlcihzdHJlYW0pIDogQnVmZmVyLmZyb20oc3RyZWFtKVxuICAgICAgcmV0dXJuIHRoaXMudXBsb2FkQnVmZmVyKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMsIGJ1ZilcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy51cGxvYWRTdHJlYW0oYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycywgc3RyZWFtLCBwYXJ0U2l6ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBtZXRob2QgdG8gdXBsb2FkIGJ1ZmZlciBpbiBvbmUgY2FsbFxuICAgKiBAcHJpdmF0ZVxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyB1cGxvYWRCdWZmZXIoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyxcbiAgICBidWY6IEJ1ZmZlcixcbiAgKTogUHJvbWlzZTxVcGxvYWRlZE9iamVjdEluZm8+IHtcbiAgICBjb25zdCB7IG1kNXN1bSwgc2hhMjU2c3VtIH0gPSBoYXNoQmluYXJ5KGJ1ZiwgdGhpcy5lbmFibGVTSEEyNTYpXG4gICAgaGVhZGVyc1snQ29udGVudC1MZW5ndGgnXSA9IGJ1Zi5sZW5ndGhcbiAgICBpZiAoIXRoaXMuZW5hYmxlU0hBMjU2KSB7XG4gICAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gbWQ1c3VtXG4gICAgfVxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RTdHJlYW1Bc3luYyhcbiAgICAgIHtcbiAgICAgICAgbWV0aG9kOiAnUFVUJyxcbiAgICAgICAgYnVja2V0TmFtZSxcbiAgICAgICAgb2JqZWN0TmFtZSxcbiAgICAgICAgaGVhZGVycyxcbiAgICAgIH0sXG4gICAgICBidWYsXG4gICAgICBzaGEyNTZzdW0sXG4gICAgICBbMjAwXSxcbiAgICAgICcnLFxuICAgIClcbiAgICBhd2FpdCBkcmFpblJlc3BvbnNlKHJlcylcbiAgICByZXR1cm4ge1xuICAgICAgZXRhZzogc2FuaXRpemVFVGFnKHJlcy5oZWFkZXJzLmV0YWcpLFxuICAgICAgdmVyc2lvbklkOiBnZXRWZXJzaW9uSWQocmVzLmhlYWRlcnMgYXMgUmVzcG9uc2VIZWFkZXIpLFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiB1cGxvYWQgc3RyZWFtIHdpdGggTXVsdGlwYXJ0VXBsb2FkXG4gICAqIEBwcml2YXRlXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHVwbG9hZFN0cmVhbShcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzLFxuICAgIGJvZHk6IHN0cmVhbS5SZWFkYWJsZSxcbiAgICBwYXJ0U2l6ZTogbnVtYmVyLFxuICApOiBQcm9taXNlPFVwbG9hZGVkT2JqZWN0SW5mbz4ge1xuICAgIC8vIEEgbWFwIG9mIHRoZSBwcmV2aW91c2x5IHVwbG9hZGVkIGNodW5rcywgZm9yIHJlc3VtaW5nIGEgZmlsZSB1cGxvYWQuIFRoaXNcbiAgICAvLyB3aWxsIGJlIG51bGwgaWYgd2UgYXJlbid0IHJlc3VtaW5nIGFuIHVwbG9hZC5cbiAgICBjb25zdCBvbGRQYXJ0czogUmVjb3JkPG51bWJlciwgUGFydD4gPSB7fVxuXG4gICAgLy8gS2VlcCB0cmFjayBvZiB0aGUgZXRhZ3MgZm9yIGFnZ3JlZ2F0aW5nIHRoZSBjaHVua3MgdG9nZXRoZXIgbGF0ZXIuIEVhY2hcbiAgICAvLyBldGFnIHJlcHJlc2VudHMgYSBzaW5nbGUgY2h1bmsgb2YgdGhlIGZpbGUuXG4gICAgY29uc3QgZVRhZ3M6IFBhcnRbXSA9IFtdXG5cbiAgICBjb25zdCBwcmV2aW91c1VwbG9hZElkID0gYXdhaXQgdGhpcy5maW5kVXBsb2FkSWQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSlcbiAgICBsZXQgdXBsb2FkSWQ6IHN0cmluZ1xuICAgIGlmICghcHJldmlvdXNVcGxvYWRJZCkge1xuICAgICAgdXBsb2FkSWQgPSBhd2FpdCB0aGlzLmluaXRpYXRlTmV3TXVsdGlwYXJ0VXBsb2FkKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMpXG4gICAgfSBlbHNlIHtcbiAgICAgIHVwbG9hZElkID0gcHJldmlvdXNVcGxvYWRJZFxuICAgICAgY29uc3Qgb2xkVGFncyA9IGF3YWl0IHRoaXMubGlzdFBhcnRzKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHByZXZpb3VzVXBsb2FkSWQpXG4gICAgICBvbGRUYWdzLmZvckVhY2goKGUpID0+IHtcbiAgICAgICAgb2xkUGFydHNbZS5wYXJ0XSA9IGVcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgY29uc3QgY2h1bmtpZXIgPSBuZXcgQmxvY2tTdHJlYW0yKHsgc2l6ZTogcGFydFNpemUsIHplcm9QYWRkaW5nOiBmYWxzZSB9KVxuXG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby11bnVzZWQtdmFyc1xuICAgIGNvbnN0IFtfLCBvXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgYm9keS5waXBlKGNodW5raWVyKS5vbignZXJyb3InLCByZWplY3QpXG4gICAgICAgIGNodW5raWVyLm9uKCdlbmQnLCByZXNvbHZlKS5vbignZXJyb3InLCByZWplY3QpXG4gICAgICB9KSxcbiAgICAgIChhc3luYyAoKSA9PiB7XG4gICAgICAgIGxldCBwYXJ0TnVtYmVyID0gMVxuXG4gICAgICAgIGZvciBhd2FpdCAoY29uc3QgY2h1bmsgb2YgY2h1bmtpZXIpIHtcbiAgICAgICAgICBjb25zdCBtZDUgPSBjcnlwdG8uY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKGNodW5rKS5kaWdlc3QoKVxuXG4gICAgICAgICAgY29uc3Qgb2xkUGFydCA9IG9sZFBhcnRzW3BhcnROdW1iZXJdXG4gICAgICAgICAgaWYgKG9sZFBhcnQpIHtcbiAgICAgICAgICAgIGlmIChvbGRQYXJ0LmV0YWcgPT09IG1kNS50b1N0cmluZygnaGV4JykpIHtcbiAgICAgICAgICAgICAgZVRhZ3MucHVzaCh7IHBhcnQ6IHBhcnROdW1iZXIsIGV0YWc6IG9sZFBhcnQuZXRhZyB9KVxuICAgICAgICAgICAgICBwYXJ0TnVtYmVyKytcbiAgICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBwYXJ0TnVtYmVyKytcblxuICAgICAgICAgIC8vIG5vdyBzdGFydCB0byB1cGxvYWQgbWlzc2luZyBwYXJ0XG4gICAgICAgICAgY29uc3Qgb3B0aW9uczogUmVxdWVzdE9wdGlvbiA9IHtcbiAgICAgICAgICAgIG1ldGhvZDogJ1BVVCcsXG4gICAgICAgICAgICBxdWVyeTogcXMuc3RyaW5naWZ5KHsgcGFydE51bWJlciwgdXBsb2FkSWQgfSksXG4gICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICdDb250ZW50LUxlbmd0aCc6IGNodW5rLmxlbmd0aCxcbiAgICAgICAgICAgICAgJ0NvbnRlbnQtTUQ1JzogbWQ1LnRvU3RyaW5nKCdiYXNlNjQnKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBidWNrZXROYW1lLFxuICAgICAgICAgICAgb2JqZWN0TmFtZSxcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQob3B0aW9ucywgY2h1bmspXG5cbiAgICAgICAgICBsZXQgZXRhZyA9IHJlc3BvbnNlLmhlYWRlcnMuZXRhZ1xuICAgICAgICAgIGlmIChldGFnKSB7XG4gICAgICAgICAgICBldGFnID0gZXRhZy5yZXBsYWNlKC9eXCIvLCAnJykucmVwbGFjZSgvXCIkLywgJycpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGV0YWcgPSAnJ1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGVUYWdzLnB1c2goeyBwYXJ0OiBwYXJ0TnVtYmVyLCBldGFnIH0pXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb21wbGV0ZU11bHRpcGFydFVwbG9hZChidWNrZXROYW1lLCBvYmplY3ROYW1lLCB1cGxvYWRJZCwgZVRhZ3MpXG4gICAgICB9KSgpLFxuICAgIF0pXG5cbiAgICByZXR1cm4gb1xuICB9XG5cbiAgYXN5bmMgcmVtb3ZlQnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPlxuICByZW1vdmVCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIGNhbGxiYWNrOiBOb1Jlc3VsdENhbGxiYWNrKTogdm9pZFxuICBhc3luYyByZW1vdmVCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3JlcGxpY2F0aW9uJ1xuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwLCAyMDRdLCAnJylcbiAgfVxuXG4gIHNldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgcmVwbGljYXRpb25Db25maWc6IFJlcGxpY2F0aW9uQ29uZmlnT3B0cyk6IHZvaWRcbiAgYXN5bmMgc2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nLCByZXBsaWNhdGlvbkNvbmZpZzogUmVwbGljYXRpb25Db25maWdPcHRzKTogUHJvbWlzZTx2b2lkPlxuICBhc3luYyBzZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIHJlcGxpY2F0aW9uQ29uZmlnOiBSZXBsaWNhdGlvbkNvbmZpZ09wdHMpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KHJlcGxpY2F0aW9uQ29uZmlnKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigncmVwbGljYXRpb25Db25maWcgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChfLmlzRW1wdHkocmVwbGljYXRpb25Db25maWcucm9sZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignUm9sZSBjYW5ub3QgYmUgZW1wdHknKVxuICAgICAgfSBlbHNlIGlmIChyZXBsaWNhdGlvbkNvbmZpZy5yb2xlICYmICFpc1N0cmluZyhyZXBsaWNhdGlvbkNvbmZpZy5yb2xlKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdJbnZhbGlkIHZhbHVlIGZvciByb2xlJywgcmVwbGljYXRpb25Db25maWcucm9sZSlcbiAgICAgIH1cbiAgICAgIGlmIChfLmlzRW1wdHkocmVwbGljYXRpb25Db25maWcucnVsZXMpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ01pbmltdW0gb25lIHJlcGxpY2F0aW9uIHJ1bGUgbXVzdCBiZSBzcGVjaWZpZWQnKVxuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3JlcGxpY2F0aW9uJ1xuICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fVxuXG4gICAgY29uc3QgcmVwbGljYXRpb25QYXJhbXNDb25maWcgPSB7XG4gICAgICBSZXBsaWNhdGlvbkNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgUm9sZTogcmVwbGljYXRpb25Db25maWcucm9sZSxcbiAgICAgICAgUnVsZTogcmVwbGljYXRpb25Db25maWcucnVsZXMsXG4gICAgICB9LFxuICAgIH1cblxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSwgaGVhZGxlc3M6IHRydWUgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChyZXBsaWNhdGlvblBhcmFtc0NvbmZpZylcbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkKVxuICB9XG5cbiAgZ2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogdm9pZFxuICBhc3luYyBnZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPFJlcGxpY2F0aW9uQ29uZmlnPlxuICBhc3luYyBnZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3JlcGxpY2F0aW9uJ1xuXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDAsIDIwNF0pXG4gICAgY29uc3QgeG1sUmVzdWx0ID0gYXdhaXQgcmVhZEFzU3RyaW5nKGh0dHBSZXMpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VSZXBsaWNhdGlvbkNvbmZpZyh4bWxSZXN1bHQpXG4gIH1cblxuICBnZXRPYmplY3RMZWdhbEhvbGQoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBnZXRPcHRzPzogR2V0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyxcbiAgICBjYWxsYmFjaz86IFJlc3VsdENhbGxiYWNrPExFR0FMX0hPTERfU1RBVFVTPixcbiAgKTogUHJvbWlzZTxMRUdBTF9IT0xEX1NUQVRVUz5cbiAgYXN5bmMgZ2V0T2JqZWN0TGVnYWxIb2xkKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgZ2V0T3B0cz86IEdldE9iamVjdExlZ2FsSG9sZE9wdGlvbnMsXG4gICk6IFByb21pc2U8TEVHQUxfSE9MRF9TVEFUVVM+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGlmIChnZXRPcHRzKSB7XG4gICAgICBpZiAoIWlzT2JqZWN0KGdldE9wdHMpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2dldE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJPYmplY3RcIicpXG4gICAgICB9IGVsc2UgaWYgKE9iamVjdC5rZXlzKGdldE9wdHMpLmxlbmd0aCA+IDAgJiYgZ2V0T3B0cy52ZXJzaW9uSWQgJiYgIWlzU3RyaW5nKGdldE9wdHMudmVyc2lvbklkKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd2ZXJzaW9uSWQgc2hvdWxkIGJlIG9mIHR5cGUgc3RyaW5nLjonLCBnZXRPcHRzLnZlcnNpb25JZClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGxldCBxdWVyeSA9ICdsZWdhbC1ob2xkJ1xuXG4gICAgaWYgKGdldE9wdHM/LnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgKz0gYCZ2ZXJzaW9uSWQ9JHtnZXRPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDBdKVxuICAgIGNvbnN0IHN0clJlcyA9IGF3YWl0IHJlYWRBc1N0cmluZyhodHRwUmVzKVxuICAgIHJldHVybiBwYXJzZU9iamVjdExlZ2FsSG9sZENvbmZpZyhzdHJSZXMpXG4gIH1cblxuICBzZXRPYmplY3RMZWdhbEhvbGQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHNldE9wdHM/OiBQdXRPYmplY3RMZWdhbEhvbGRPcHRpb25zKTogdm9pZFxuICBhc3luYyBzZXRPYmplY3RMZWdhbEhvbGQoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBzZXRPcHRzID0ge1xuICAgICAgc3RhdHVzOiBMRUdBTF9IT0xEX1NUQVRVUy5FTkFCTEVELFxuICAgIH0gYXMgUHV0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoIWlzT2JqZWN0KHNldE9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzZXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwiT2JqZWN0XCInKVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIVtMRUdBTF9IT0xEX1NUQVRVUy5FTkFCTEVELCBMRUdBTF9IT0xEX1NUQVRVUy5ESVNBQkxFRF0uaW5jbHVkZXMoc2V0T3B0cz8uc3RhdHVzKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdJbnZhbGlkIHN0YXR1czogJyArIHNldE9wdHMuc3RhdHVzKVxuICAgICAgfVxuICAgICAgaWYgKHNldE9wdHMudmVyc2lvbklkICYmICFzZXRPcHRzLnZlcnNpb25JZC5sZW5ndGgpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmVyc2lvbklkIHNob3VsZCBiZSBvZiB0eXBlIHN0cmluZy46JyArIHNldE9wdHMudmVyc2lvbklkKVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ2xlZ2FsLWhvbGQnXG5cbiAgICBpZiAoc2V0T3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ICs9IGAmdmVyc2lvbklkPSR7c2V0T3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cblxuICAgIGNvbnN0IGNvbmZpZyA9IHtcbiAgICAgIFN0YXR1czogc2V0T3B0cy5zdGF0dXMsXG4gICAgfVxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7IHJvb3ROYW1lOiAnTGVnYWxIb2xkJywgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sIGhlYWRsZXNzOiB0cnVlIH0pXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoY29uZmlnKVxuICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fVxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZClcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgVGFncyBhc3NvY2lhdGVkIHdpdGggYSBCdWNrZXRcbiAgICovXG4gIGFzeW5jIGdldEJ1Y2tldFRhZ2dpbmcoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxUYWdbXT4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICd0YWdnaW5nJ1xuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH1cblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHJlcXVlc3RPcHRpb25zKVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzcG9uc2UpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VUYWdnaW5nKGJvZHkpXG4gIH1cblxuICAvKipcbiAgICogIEdldCB0aGUgdGFncyBhc3NvY2lhdGVkIHdpdGggYSBidWNrZXQgT1IgYW4gb2JqZWN0XG4gICAqL1xuICBhc3luYyBnZXRPYmplY3RUYWdnaW5nKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBnZXRPcHRzPzogR2V0T2JqZWN0T3B0cyk6IFByb21pc2U8VGFnW10+IHtcbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGxldCBxdWVyeSA9ICd0YWdnaW5nJ1xuXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIG9iamVjdCBuYW1lOiAnICsgb2JqZWN0TmFtZSlcbiAgICB9XG4gICAgaWYgKGdldE9wdHMgJiYgIWlzT2JqZWN0KGdldE9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdnZXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIGlmIChnZXRPcHRzICYmIGdldE9wdHMudmVyc2lvbklkKSB7XG4gICAgICBxdWVyeSA9IGAke3F1ZXJ5fSZ2ZXJzaW9uSWQ9JHtnZXRPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zOiBSZXF1ZXN0T3B0aW9uID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH1cbiAgICBpZiAob2JqZWN0TmFtZSkge1xuICAgICAgcmVxdWVzdE9wdGlvbnNbJ29iamVjdE5hbWUnXSA9IG9iamVjdE5hbWVcbiAgICB9XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhyZXF1ZXN0T3B0aW9ucylcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlc3BvbnNlKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlVGFnZ2luZyhib2R5KVxuICB9XG5cbiAgLyoqXG4gICAqICBTZXQgdGhlIHBvbGljeSBvbiBhIGJ1Y2tldCBvciBhbiBvYmplY3QgcHJlZml4LlxuICAgKi9cbiAgYXN5bmMgc2V0QnVja2V0UG9saWN5KGJ1Y2tldE5hbWU6IHN0cmluZywgcG9saWN5OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBWYWxpZGF0ZSBhcmd1bWVudHMuXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwb2xpY3kpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXRQb2xpY3lFcnJvcihgSW52YWxpZCBidWNrZXQgcG9saWN5OiAke3BvbGljeX0gLSBtdXN0IGJlIFwic3RyaW5nXCJgKVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5ID0gJ3BvbGljeSdcblxuICAgIGxldCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGlmIChwb2xpY3kpIHtcbiAgICAgIG1ldGhvZCA9ICdQVVQnXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgcG9saWN5LCBbMjA0XSwgJycpXG4gIH1cblxuICAvKipcbiAgICogR2V0IHRoZSBwb2xpY3kgb24gYSBidWNrZXQgb3IgYW4gb2JqZWN0IHByZWZpeC5cbiAgICovXG4gIGFzeW5jIGdldEJ1Y2tldFBvbGljeShidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIC8vIFZhbGlkYXRlIGFyZ3VtZW50cy5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAncG9saWN5J1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICByZXR1cm4gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgfVxuXG4gIGFzeW5jIHB1dE9iamVjdFJldGVudGlvbihidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgcmV0ZW50aW9uT3B0czogUmV0ZW50aW9uID0ge30pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KHJldGVudGlvbk9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdyZXRlbnRpb25PcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAocmV0ZW50aW9uT3B0cy5nb3Zlcm5hbmNlQnlwYXNzICYmICFpc0Jvb2xlYW4ocmV0ZW50aW9uT3B0cy5nb3Zlcm5hbmNlQnlwYXNzKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHZhbHVlIGZvciBnb3Zlcm5hbmNlQnlwYXNzOiAke3JldGVudGlvbk9wdHMuZ292ZXJuYW5jZUJ5cGFzc31gKVxuICAgICAgfVxuICAgICAgaWYgKFxuICAgICAgICByZXRlbnRpb25PcHRzLm1vZGUgJiZcbiAgICAgICAgIVtSRVRFTlRJT05fTU9ERVMuQ09NUExJQU5DRSwgUkVURU5USU9OX01PREVTLkdPVkVSTkFOQ0VdLmluY2x1ZGVzKHJldGVudGlvbk9wdHMubW9kZSlcbiAgICAgICkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIG9iamVjdCByZXRlbnRpb24gbW9kZTogJHtyZXRlbnRpb25PcHRzLm1vZGV9YClcbiAgICAgIH1cbiAgICAgIGlmIChyZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZSAmJiAhaXNTdHJpbmcocmV0ZW50aW9uT3B0cy5yZXRhaW5VbnRpbERhdGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgdmFsdWUgZm9yIHJldGFpblVudGlsRGF0ZTogJHtyZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZX1gKVxuICAgICAgfVxuICAgICAgaWYgKHJldGVudGlvbk9wdHMudmVyc2lvbklkICYmICFpc1N0cmluZyhyZXRlbnRpb25PcHRzLnZlcnNpb25JZCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCB2YWx1ZSBmb3IgdmVyc2lvbklkOiAke3JldGVudGlvbk9wdHMudmVyc2lvbklkfWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBsZXQgcXVlcnkgPSAncmV0ZW50aW9uJ1xuXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxuICAgIGlmIChyZXRlbnRpb25PcHRzLmdvdmVybmFuY2VCeXBhc3MpIHtcbiAgICAgIGhlYWRlcnNbJ1gtQW16LUJ5cGFzcy1Hb3Zlcm5hbmNlLVJldGVudGlvbiddID0gdHJ1ZVxuICAgIH1cblxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyByb290TmFtZTogJ1JldGVudGlvbicsIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LCBoZWFkbGVzczogdHJ1ZSB9KVxuICAgIGNvbnN0IHBhcmFtczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XG5cbiAgICBpZiAocmV0ZW50aW9uT3B0cy5tb2RlKSB7XG4gICAgICBwYXJhbXMuTW9kZSA9IHJldGVudGlvbk9wdHMubW9kZVxuICAgIH1cbiAgICBpZiAocmV0ZW50aW9uT3B0cy5yZXRhaW5VbnRpbERhdGUpIHtcbiAgICAgIHBhcmFtcy5SZXRhaW5VbnRpbERhdGUgPSByZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZVxuICAgIH1cbiAgICBpZiAocmV0ZW50aW9uT3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ICs9IGAmdmVyc2lvbklkPSR7cmV0ZW50aW9uT3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cblxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KHBhcmFtcylcblxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQsIFsyMDAsIDIwNF0pXG4gIH1cblxuICBnZXRPYmplY3RMb2NrQ29uZmlnKGJ1Y2tldE5hbWU6IHN0cmluZywgY2FsbGJhY2s6IFJlc3VsdENhbGxiYWNrPE9iamVjdExvY2tJbmZvPik6IHZvaWRcbiAgZ2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcpOiB2b2lkXG4gIGFzeW5jIGdldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxPYmplY3RMb2NrSW5mbz5cbiAgYXN5bmMgZ2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ29iamVjdC1sb2NrJ1xuXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICBjb25zdCB4bWxSZXN1bHQgPSBhd2FpdCByZWFkQXNTdHJpbmcoaHR0cFJlcylcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZU9iamVjdExvY2tDb25maWcoeG1sUmVzdWx0KVxuICB9XG5cbiAgc2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcsIGxvY2tDb25maWdPcHRzOiBPbWl0PE9iamVjdExvY2tJbmZvLCAnb2JqZWN0TG9ja0VuYWJsZWQnPik6IHZvaWRcbiAgYXN5bmMgc2V0T2JqZWN0TG9ja0NvbmZpZyhcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgbG9ja0NvbmZpZ09wdHM6IE9taXQ8T2JqZWN0TG9ja0luZm8sICdvYmplY3RMb2NrRW5hYmxlZCc+LFxuICApOiBQcm9taXNlPHZvaWQ+XG4gIGFzeW5jIHNldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZTogc3RyaW5nLCBsb2NrQ29uZmlnT3B0czogT21pdDxPYmplY3RMb2NrSW5mbywgJ29iamVjdExvY2tFbmFibGVkJz4pIHtcbiAgICBjb25zdCByZXRlbnRpb25Nb2RlcyA9IFtSRVRFTlRJT05fTU9ERVMuQ09NUExJQU5DRSwgUkVURU5USU9OX01PREVTLkdPVkVSTkFOQ0VdXG4gICAgY29uc3QgdmFsaWRVbml0cyA9IFtSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMuREFZUywgUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLllFQVJTXVxuXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG5cbiAgICBpZiAobG9ja0NvbmZpZ09wdHMubW9kZSAmJiAhcmV0ZW50aW9uTW9kZXMuaW5jbHVkZXMobG9ja0NvbmZpZ09wdHMubW9kZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGxvY2tDb25maWdPcHRzLm1vZGUgc2hvdWxkIGJlIG9uZSBvZiAke3JldGVudGlvbk1vZGVzfWApXG4gICAgfVxuICAgIGlmIChsb2NrQ29uZmlnT3B0cy51bml0ICYmICF2YWxpZFVuaXRzLmluY2x1ZGVzKGxvY2tDb25maWdPcHRzLnVuaXQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBsb2NrQ29uZmlnT3B0cy51bml0IHNob3VsZCBiZSBvbmUgb2YgJHt2YWxpZFVuaXRzfWApXG4gICAgfVxuICAgIGlmIChsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSAmJiAhaXNOdW1iZXIobG9ja0NvbmZpZ09wdHMudmFsaWRpdHkpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSBzaG91bGQgYmUgYSBudW1iZXJgKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgcXVlcnkgPSAnb2JqZWN0LWxvY2snXG5cbiAgICBjb25zdCBjb25maWc6IE9iamVjdExvY2tDb25maWdQYXJhbSA9IHtcbiAgICAgIE9iamVjdExvY2tFbmFibGVkOiAnRW5hYmxlZCcsXG4gICAgfVxuICAgIGNvbnN0IGNvbmZpZ0tleXMgPSBPYmplY3Qua2V5cyhsb2NrQ29uZmlnT3B0cylcblxuICAgIGNvbnN0IGlzQWxsS2V5c1NldCA9IFsndW5pdCcsICdtb2RlJywgJ3ZhbGlkaXR5J10uZXZlcnkoKGxjaykgPT4gY29uZmlnS2V5cy5pbmNsdWRlcyhsY2spKVxuICAgIC8vIENoZWNrIGlmIGtleXMgYXJlIHByZXNlbnQgYW5kIGFsbCBrZXlzIGFyZSBwcmVzZW50LlxuICAgIGlmIChjb25maWdLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgIGlmICghaXNBbGxLZXlzU2V0KSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICAgYGxvY2tDb25maWdPcHRzLm1vZGUsbG9ja0NvbmZpZ09wdHMudW5pdCxsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSBhbGwgdGhlIHByb3BlcnRpZXMgc2hvdWxkIGJlIHNwZWNpZmllZC5gLFxuICAgICAgICApXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25maWcuUnVsZSA9IHtcbiAgICAgICAgICBEZWZhdWx0UmV0ZW50aW9uOiB7fSxcbiAgICAgICAgfVxuICAgICAgICBpZiAobG9ja0NvbmZpZ09wdHMubW9kZSkge1xuICAgICAgICAgIGNvbmZpZy5SdWxlLkRlZmF1bHRSZXRlbnRpb24uTW9kZSA9IGxvY2tDb25maWdPcHRzLm1vZGVcbiAgICAgICAgfVxuICAgICAgICBpZiAobG9ja0NvbmZpZ09wdHMudW5pdCA9PT0gUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLkRBWVMpIHtcbiAgICAgICAgICBjb25maWcuUnVsZS5EZWZhdWx0UmV0ZW50aW9uLkRheXMgPSBsb2NrQ29uZmlnT3B0cy52YWxpZGl0eVxuICAgICAgICB9IGVsc2UgaWYgKGxvY2tDb25maWdPcHRzLnVuaXQgPT09IFJFVEVOVElPTl9WQUxJRElUWV9VTklUUy5ZRUFSUykge1xuICAgICAgICAgIGNvbmZpZy5SdWxlLkRlZmF1bHRSZXRlbnRpb24uWWVhcnMgPSBsb2NrQ29uZmlnT3B0cy52YWxpZGl0eVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ09iamVjdExvY2tDb25maWd1cmF0aW9uJyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChjb25maWcpXG5cbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG5cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkKVxuICB9XG5cbiAgYXN5bmMgZ2V0QnVja2V0VmVyc2lvbmluZyhidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPEJ1Y2tldFZlcnNpb25pbmdDb25maWd1cmF0aW9uPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICd2ZXJzaW9uaW5nJ1xuXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICBjb25zdCB4bWxSZXN1bHQgPSBhd2FpdCByZWFkQXNTdHJpbmcoaHR0cFJlcylcbiAgICByZXR1cm4gYXdhaXQgeG1sUGFyc2Vycy5wYXJzZUJ1Y2tldFZlcnNpb25pbmdDb25maWcoeG1sUmVzdWx0KVxuICB9XG5cbiAgYXN5bmMgc2V0QnVja2V0VmVyc2lvbmluZyhidWNrZXROYW1lOiBzdHJpbmcsIHZlcnNpb25Db25maWc6IEJ1Y2tldFZlcnNpb25pbmdDb25maWd1cmF0aW9uKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFPYmplY3Qua2V5cyh2ZXJzaW9uQ29uZmlnKS5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3ZlcnNpb25Db25maWcgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBxdWVyeSA9ICd2ZXJzaW9uaW5nJ1xuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xuICAgICAgcm9vdE5hbWU6ICdWZXJzaW9uaW5nQ29uZmlndXJhdGlvbicsXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxuICAgIH0pXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QodmVyc2lvbkNvbmZpZylcblxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sIHBheWxvYWQpXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNldFRhZ2dpbmcodGFnZ2luZ1BhcmFtczogUHV0VGFnZ2luZ1BhcmFtcyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdGFncywgcHV0T3B0cyB9ID0gdGFnZ2luZ1BhcmFtc1xuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ3RhZ2dpbmcnXG5cbiAgICBpZiAocHV0T3B0cyAmJiBwdXRPcHRzPy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcnl9JnZlcnNpb25JZD0ke3B1dE9wdHMudmVyc2lvbklkfWBcbiAgICB9XG4gICAgY29uc3QgdGFnc0xpc3QgPSBbXVxuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHRhZ3MpKSB7XG4gICAgICB0YWdzTGlzdC5wdXNoKHsgS2V5OiBrZXksIFZhbHVlOiB2YWx1ZSB9KVxuICAgIH1cbiAgICBjb25zdCB0YWdnaW5nQ29uZmlnID0ge1xuICAgICAgVGFnZ2luZzoge1xuICAgICAgICBUYWdTZXQ6IHtcbiAgICAgICAgICBUYWc6IHRhZ3NMaXN0LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9XG4gICAgY29uc3QgaGVhZGVycyA9IHt9IGFzIFJlcXVlc3RIZWFkZXJzXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7IGhlYWRsZXNzOiB0cnVlLCByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSB9KVxuICAgIGNvbnN0IHBheWxvYWRCdWYgPSBCdWZmZXIuZnJvbShidWlsZGVyLmJ1aWxkT2JqZWN0KHRhZ2dpbmdDb25maWcpKVxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0ge1xuICAgICAgbWV0aG9kLFxuICAgICAgYnVja2V0TmFtZSxcbiAgICAgIHF1ZXJ5LFxuICAgICAgaGVhZGVycyxcblxuICAgICAgLi4uKG9iamVjdE5hbWUgJiYgeyBvYmplY3ROYW1lOiBvYmplY3ROYW1lIH0pLFxuICAgIH1cblxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkQnVmKVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdChyZXF1ZXN0T3B0aW9ucywgcGF5bG9hZEJ1ZilcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVtb3ZlVGFnZ2luZyh7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHJlbW92ZU9wdHMgfTogUmVtb3ZlVGFnZ2luZ1BhcmFtcyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgbGV0IHF1ZXJ5ID0gJ3RhZ2dpbmcnXG5cbiAgICBpZiAocmVtb3ZlT3B0cyAmJiBPYmplY3Qua2V5cyhyZW1vdmVPcHRzKS5sZW5ndGggJiYgcmVtb3ZlT3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcnl9JnZlcnNpb25JZD0ke3JlbW92ZU9wdHMudmVyc2lvbklkfWBcbiAgICB9XG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfVxuXG4gICAgaWYgKG9iamVjdE5hbWUpIHtcbiAgICAgIHJlcXVlc3RPcHRpb25zWydvYmplY3ROYW1lJ10gPSBvYmplY3ROYW1lXG4gICAgfVxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhyZXF1ZXN0T3B0aW9ucywgJycsIFsyMDAsIDIwNF0pXG4gIH1cblxuICBhc3luYyBzZXRCdWNrZXRUYWdnaW5nKGJ1Y2tldE5hbWU6IHN0cmluZywgdGFnczogVGFncyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QodGFncykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3RhZ3Mgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmIChPYmplY3Qua2V5cyh0YWdzKS5sZW5ndGggPiAxMCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignbWF4aW11bSB0YWdzIGFsbG93ZWQgaXMgMTBcIicpXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zZXRUYWdnaW5nKHsgYnVja2V0TmFtZSwgdGFncyB9KVxuICB9XG5cbiAgYXN5bmMgcmVtb3ZlQnVja2V0VGFnZ2luZyhidWNrZXROYW1lOiBzdHJpbmcpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBhd2FpdCB0aGlzLnJlbW92ZVRhZ2dpbmcoeyBidWNrZXROYW1lIH0pXG4gIH1cblxuICBhc3luYyBzZXRPYmplY3RUYWdnaW5nKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCB0YWdzOiBUYWdzLCBwdXRPcHRzPzogVGFnZ2luZ09wdHMpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgb2JqZWN0IG5hbWU6ICcgKyBvYmplY3ROYW1lKVxuICAgIH1cblxuICAgIGlmICghaXNPYmplY3QodGFncykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3RhZ3Mgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmIChPYmplY3Qua2V5cyh0YWdzKS5sZW5ndGggPiAxMCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignTWF4aW11bSB0YWdzIGFsbG93ZWQgaXMgMTBcIicpXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zZXRUYWdnaW5nKHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdGFncywgcHV0T3B0cyB9KVxuICB9XG5cbiAgYXN5bmMgcmVtb3ZlT2JqZWN0VGFnZ2luZyhidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgcmVtb3ZlT3B0czogVGFnZ2luZ09wdHMpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgb2JqZWN0IG5hbWU6ICcgKyBvYmplY3ROYW1lKVxuICAgIH1cbiAgICBpZiAocmVtb3ZlT3B0cyAmJiBPYmplY3Qua2V5cyhyZW1vdmVPcHRzKS5sZW5ndGggJiYgIWlzT2JqZWN0KHJlbW92ZU9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdyZW1vdmVPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucmVtb3ZlVGFnZ2luZyh7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHJlbW92ZU9wdHMgfSlcbiAgfVxuXG4gIGFzeW5jIHNlbGVjdE9iamVjdENvbnRlbnQoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBzZWxlY3RPcHRzOiBTZWxlY3RPcHRpb25zLFxuICApOiBQcm9taXNlPFNlbGVjdFJlc3VsdHMgfCB1bmRlZmluZWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIV8uaXNFbXB0eShzZWxlY3RPcHRzKSkge1xuICAgICAgaWYgKCFpc1N0cmluZyhzZWxlY3RPcHRzLmV4cHJlc3Npb24pKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NxbEV4cHJlc3Npb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgICB9XG4gICAgICBpZiAoIV8uaXNFbXB0eShzZWxlY3RPcHRzLmlucHV0U2VyaWFsaXphdGlvbikpIHtcbiAgICAgICAgaWYgKCFpc09iamVjdChzZWxlY3RPcHRzLmlucHV0U2VyaWFsaXphdGlvbikpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdpbnB1dFNlcmlhbGl6YXRpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2lucHV0U2VyaWFsaXphdGlvbiBpcyByZXF1aXJlZCcpXG4gICAgICB9XG4gICAgICBpZiAoIV8uaXNFbXB0eShzZWxlY3RPcHRzLm91dHB1dFNlcmlhbGl6YXRpb24pKSB7XG4gICAgICAgIGlmICghaXNPYmplY3Qoc2VsZWN0T3B0cy5vdXRwdXRTZXJpYWxpemF0aW9uKSkge1xuICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ291dHB1dFNlcmlhbGl6YXRpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ291dHB1dFNlcmlhbGl6YXRpb24gaXMgcmVxdWlyZWQnKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd2YWxpZCBzZWxlY3QgY29uZmlndXJhdGlvbiBpcyByZXF1aXJlZCcpXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BPU1QnXG4gICAgY29uc3QgcXVlcnkgPSBgc2VsZWN0JnNlbGVjdC10eXBlPTJgXG5cbiAgICBjb25zdCBjb25maWc6IFJlY29yZDxzdHJpbmcsIHVua25vd24+W10gPSBbXG4gICAgICB7XG4gICAgICAgIEV4cHJlc3Npb246IHNlbGVjdE9wdHMuZXhwcmVzc2lvbixcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIEV4cHJlc3Npb25UeXBlOiBzZWxlY3RPcHRzLmV4cHJlc3Npb25UeXBlIHx8ICdTUUwnLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgSW5wdXRTZXJpYWxpemF0aW9uOiBbc2VsZWN0T3B0cy5pbnB1dFNlcmlhbGl6YXRpb25dLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgT3V0cHV0U2VyaWFsaXphdGlvbjogW3NlbGVjdE9wdHMub3V0cHV0U2VyaWFsaXphdGlvbl0sXG4gICAgICB9LFxuICAgIF1cblxuICAgIC8vIE9wdGlvbmFsXG4gICAgaWYgKHNlbGVjdE9wdHMucmVxdWVzdFByb2dyZXNzKSB7XG4gICAgICBjb25maWcucHVzaCh7IFJlcXVlc3RQcm9ncmVzczogc2VsZWN0T3B0cz8ucmVxdWVzdFByb2dyZXNzIH0pXG4gICAgfVxuICAgIC8vIE9wdGlvbmFsXG4gICAgaWYgKHNlbGVjdE9wdHMuc2NhblJhbmdlKSB7XG4gICAgICBjb25maWcucHVzaCh7IFNjYW5SYW5nZTogc2VsZWN0T3B0cy5zY2FuUmFuZ2UgfSlcbiAgICB9XG5cbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHtcbiAgICAgIHJvb3ROYW1lOiAnU2VsZWN0T2JqZWN0Q29udGVudFJlcXVlc3QnLFxuICAgICAgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sXG4gICAgICBoZWFkbGVzczogdHJ1ZSxcbiAgICB9KVxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KGNvbmZpZylcblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSwgcGF5bG9hZClcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzQnVmZmVyKHJlcylcbiAgICByZXR1cm4gcGFyc2VTZWxlY3RPYmplY3RDb250ZW50UmVzcG9uc2UoYm9keSlcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYXBwbHlCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZTogc3RyaW5nLCBwb2xpY3lDb25maWc6IExpZmVDeWNsZUNvbmZpZ1BhcmFtKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBxdWVyeSA9ICdsaWZlY3ljbGUnXG5cbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ0xpZmVjeWNsZUNvbmZpZ3VyYXRpb24nLFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcbiAgICB9KVxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KHBvbGljeUNvbmZpZylcbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcblxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQpXG4gIH1cblxuICBhc3luYyByZW1vdmVCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBjb25zdCBxdWVyeSA9ICdsaWZlY3ljbGUnXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDRdKVxuICB9XG5cbiAgYXN5bmMgc2V0QnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWU6IHN0cmluZywgbGlmZUN5Y2xlQ29uZmlnOiBMaWZlQ3ljbGVDb25maWdQYXJhbSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmIChfLmlzRW1wdHkobGlmZUN5Y2xlQ29uZmlnKSkge1xuICAgICAgYXdhaXQgdGhpcy5yZW1vdmVCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZSlcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5hcHBseUJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lLCBsaWZlQ3ljbGVDb25maWcpXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZ2V0QnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8TGlmZWN5Y2xlQ29uZmlnIHwgbnVsbD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAnbGlmZWN5Y2xlJ1xuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlTGlmZWN5Y2xlQ29uZmlnKGJvZHkpXG4gIH1cblxuICBhc3luYyBzZXRCdWNrZXRFbmNyeXB0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgZW5jcnlwdGlvbkNvbmZpZz86IEVuY3J5cHRpb25Db25maWcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIV8uaXNFbXB0eShlbmNyeXB0aW9uQ29uZmlnKSAmJiBlbmNyeXB0aW9uQ29uZmlnLlJ1bGUubGVuZ3RoID4gMSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW52YWxpZCBSdWxlIGxlbmd0aC4gT25seSBvbmUgcnVsZSBpcyBhbGxvd2VkLjogJyArIGVuY3J5cHRpb25Db25maWcuUnVsZSlcbiAgICB9XG5cbiAgICBsZXQgZW5jcnlwdGlvbk9iaiA9IGVuY3J5cHRpb25Db25maWdcbiAgICBpZiAoXy5pc0VtcHR5KGVuY3J5cHRpb25Db25maWcpKSB7XG4gICAgICBlbmNyeXB0aW9uT2JqID0ge1xuICAgICAgICAvLyBEZWZhdWx0IE1pbklPIFNlcnZlciBTdXBwb3J0ZWQgUnVsZVxuICAgICAgICBSdWxlOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgQXBwbHlTZXJ2ZXJTaWRlRW5jcnlwdGlvbkJ5RGVmYXVsdDoge1xuICAgICAgICAgICAgICBTU0VBbGdvcml0aG06ICdBRVMyNTYnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgcXVlcnkgPSAnZW5jcnlwdGlvbidcbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHtcbiAgICAgIHJvb3ROYW1lOiAnU2VydmVyU2lkZUVuY3J5cHRpb25Db25maWd1cmF0aW9uJyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChlbmNyeXB0aW9uT2JqKVxuXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZClcbiAgfVxuXG4gIGFzeW5jIGdldEJ1Y2tldEVuY3J5cHRpb24oYnVja2V0TmFtZTogc3RyaW5nKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICdlbmNyeXB0aW9uJ1xuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlQnVja2V0RW5jcnlwdGlvbkNvbmZpZyhib2R5KVxuICB9XG5cbiAgYXN5bmMgcmVtb3ZlQnVja2V0RW5jcnlwdGlvbihidWNrZXROYW1lOiBzdHJpbmcpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2VuY3J5cHRpb24nXG5cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwNF0pXG4gIH1cblxuICBhc3luYyBnZXRPYmplY3RSZXRlbnRpb24oXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBnZXRPcHRzPzogR2V0T2JqZWN0UmV0ZW50aW9uT3B0cyxcbiAgKTogUHJvbWlzZTxPYmplY3RSZXRlbnRpb25JbmZvIHwgbnVsbCB8IHVuZGVmaW5lZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmIChnZXRPcHRzICYmICFpc09iamVjdChnZXRPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignZ2V0T3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9IGVsc2UgaWYgKGdldE9wdHM/LnZlcnNpb25JZCAmJiAhaXNTdHJpbmcoZ2V0T3B0cy52ZXJzaW9uSWQpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd2ZXJzaW9uSWQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBsZXQgcXVlcnkgPSAncmV0ZW50aW9uJ1xuICAgIGlmIChnZXRPcHRzPy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ICs9IGAmdmVyc2lvbklkPSR7Z2V0T3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0pXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VPYmplY3RSZXRlbnRpb25Db25maWcoYm9keSlcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZU9iamVjdHMoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3RzTGlzdDogUmVtb3ZlT2JqZWN0c1BhcmFtKTogUHJvbWlzZTxSZW1vdmVPYmplY3RzUmVzcG9uc2VbXT4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghQXJyYXkuaXNBcnJheShvYmplY3RzTGlzdCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ29iamVjdHNMaXN0IHNob3VsZCBiZSBhIGxpc3QnKVxuICAgIH1cblxuICAgIGNvbnN0IHJ1bkRlbGV0ZU9iamVjdHMgPSBhc3luYyAoYmF0Y2g6IFJlbW92ZU9iamVjdHNQYXJhbSk6IFByb21pc2U8UmVtb3ZlT2JqZWN0c1Jlc3BvbnNlW10+ID0+IHtcbiAgICAgIGNvbnN0IGRlbE9iamVjdHM6IFJlbW92ZU9iamVjdHNSZXF1ZXN0RW50cnlbXSA9IGJhdGNoLm1hcCgodmFsdWUpID0+IHtcbiAgICAgICAgcmV0dXJuIGlzT2JqZWN0KHZhbHVlKSA/IHsgS2V5OiB2YWx1ZS5uYW1lLCBWZXJzaW9uSWQ6IHZhbHVlLnZlcnNpb25JZCB9IDogeyBLZXk6IHZhbHVlIH1cbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IHJlbU9iamVjdHMgPSB7IERlbGV0ZTogeyBRdWlldDogdHJ1ZSwgT2JqZWN0OiBkZWxPYmplY3RzIH0gfVxuICAgICAgY29uc3QgcGF5bG9hZCA9IEJ1ZmZlci5mcm9tKG5ldyB4bWwyanMuQnVpbGRlcih7IGhlYWRsZXNzOiB0cnVlIH0pLmJ1aWxkT2JqZWN0KHJlbU9iamVjdHMpKVxuICAgICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7ICdDb250ZW50LU1ENSc6IHRvTWQ1KHBheWxvYWQpIH1cblxuICAgICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kOiAnUE9TVCcsIGJ1Y2tldE5hbWUsIHF1ZXJ5OiAnZGVsZXRlJywgaGVhZGVycyB9LCBwYXlsb2FkKVxuICAgICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gICAgICByZXR1cm4geG1sUGFyc2Vycy5yZW1vdmVPYmplY3RzUGFyc2VyKGJvZHkpXG4gICAgfVxuXG4gICAgY29uc3QgbWF4RW50cmllcyA9IDEwMDAgLy8gbWF4IGVudHJpZXMgYWNjZXB0ZWQgaW4gc2VydmVyIGZvciBEZWxldGVNdWx0aXBsZU9iamVjdHMgQVBJLlxuICAgIC8vIENsaWVudCBzaWRlIGJhdGNoaW5nXG4gICAgY29uc3QgYmF0Y2hlcyA9IFtdXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBvYmplY3RzTGlzdC5sZW5ndGg7IGkgKz0gbWF4RW50cmllcykge1xuICAgICAgYmF0Y2hlcy5wdXNoKG9iamVjdHNMaXN0LnNsaWNlKGksIGkgKyBtYXhFbnRyaWVzKSlcbiAgICB9XG5cbiAgICBjb25zdCBiYXRjaFJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbChiYXRjaGVzLm1hcChydW5EZWxldGVPYmplY3RzKSlcbiAgICByZXR1cm4gYmF0Y2hSZXN1bHRzLmZsYXQoKVxuICB9XG5cbiAgYXN5bmMgcmVtb3ZlSW5jb21wbGV0ZVVwbG9hZChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSXNWYWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGNvbnN0IHJlbW92ZVVwbG9hZElkID0gYXdhaXQgdGhpcy5maW5kVXBsb2FkSWQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSlcbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gYHVwbG9hZElkPSR7cmVtb3ZlVXBsb2FkSWR9YFxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjA0XSlcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY29weU9iamVjdFYxKFxuICAgIHRhcmdldEJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICB0YXJnZXRPYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBjb25kaXRpb25zPzogbnVsbCB8IENvcHlDb25kaXRpb25zLFxuICApIHtcbiAgICBpZiAodHlwZW9mIGNvbmRpdGlvbnMgPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgY29uZGl0aW9ucyA9IG51bGxcbiAgICB9XG5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKHRhcmdldEJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyB0YXJnZXRCdWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKHRhcmdldE9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7dGFyZ2V0T2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWUgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmIChzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSA9PT0gJycpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFByZWZpeEVycm9yKGBFbXB0eSBzb3VyY2UgcHJlZml4YClcbiAgICB9XG5cbiAgICBpZiAoY29uZGl0aW9ucyAhPSBudWxsICYmICEoY29uZGl0aW9ucyBpbnN0YW5jZW9mIENvcHlDb25kaXRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY29uZGl0aW9ucyBzaG91bGQgYmUgb2YgdHlwZSBcIkNvcHlDb25kaXRpb25zXCInKVxuICAgIH1cblxuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cbiAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZSddID0gdXJpUmVzb3VyY2VFc2NhcGUoc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWUpXG5cbiAgICBpZiAoY29uZGl0aW9ucykge1xuICAgICAgaWYgKGNvbmRpdGlvbnMubW9kaWZpZWQgIT09ICcnKSB7XG4gICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLWlmLW1vZGlmaWVkLXNpbmNlJ10gPSBjb25kaXRpb25zLm1vZGlmaWVkXG4gICAgICB9XG4gICAgICBpZiAoY29uZGl0aW9ucy51bm1vZGlmaWVkICE9PSAnJykge1xuICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS1pZi11bm1vZGlmaWVkLXNpbmNlJ10gPSBjb25kaXRpb25zLnVubW9kaWZpZWRcbiAgICAgIH1cbiAgICAgIGlmIChjb25kaXRpb25zLm1hdGNoRVRhZyAhPT0gJycpIHtcbiAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtaWYtbWF0Y2gnXSA9IGNvbmRpdGlvbnMubWF0Y2hFVGFnXG4gICAgICB9XG4gICAgICBpZiAoY29uZGl0aW9ucy5tYXRjaEVUYWdFeGNlcHQgIT09ICcnKSB7XG4gICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLWlmLW5vbmUtbWF0Y2gnXSA9IGNvbmRpdGlvbnMubWF0Y2hFVGFnRXhjZXB0XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7XG4gICAgICBtZXRob2QsXG4gICAgICBidWNrZXROYW1lOiB0YXJnZXRCdWNrZXROYW1lLFxuICAgICAgb2JqZWN0TmFtZTogdGFyZ2V0T2JqZWN0TmFtZSxcbiAgICAgIGhlYWRlcnMsXG4gICAgfSlcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZUNvcHlPYmplY3QoYm9keSlcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY29weU9iamVjdFYyKFxuICAgIHNvdXJjZUNvbmZpZzogQ29weVNvdXJjZU9wdGlvbnMsXG4gICAgZGVzdENvbmZpZzogQ29weURlc3RpbmF0aW9uT3B0aW9ucyxcbiAgKTogUHJvbWlzZTxDb3B5T2JqZWN0UmVzdWx0VjI+IHtcbiAgICBpZiAoIShzb3VyY2VDb25maWcgaW5zdGFuY2VvZiBDb3B5U291cmNlT3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3NvdXJjZUNvbmZpZyBzaG91bGQgb2YgdHlwZSBDb3B5U291cmNlT3B0aW9ucyAnKVxuICAgIH1cbiAgICBpZiAoIShkZXN0Q29uZmlnIGluc3RhbmNlb2YgQ29weURlc3RpbmF0aW9uT3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2Rlc3RDb25maWcgc2hvdWxkIG9mIHR5cGUgQ29weURlc3RpbmF0aW9uT3B0aW9ucyAnKVxuICAgIH1cbiAgICBpZiAoIWRlc3RDb25maWcudmFsaWRhdGUoKSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KClcbiAgICB9XG4gICAgaWYgKCFkZXN0Q29uZmlnLnZhbGlkYXRlKCkpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdCgpXG4gICAgfVxuXG4gICAgY29uc3QgaGVhZGVycyA9IE9iamVjdC5hc3NpZ24oe30sIHNvdXJjZUNvbmZpZy5nZXRIZWFkZXJzKCksIGRlc3RDb25maWcuZ2V0SGVhZGVycygpKVxuXG4gICAgY29uc3QgYnVja2V0TmFtZSA9IGRlc3RDb25maWcuQnVja2V0XG4gICAgY29uc3Qgb2JqZWN0TmFtZSA9IGRlc3RDb25maWcuT2JqZWN0XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzIH0pXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gICAgY29uc3QgY29weVJlcyA9IHhtbFBhcnNlcnMucGFyc2VDb3B5T2JqZWN0KGJvZHkpXG4gICAgY29uc3QgcmVzSGVhZGVyczogSW5jb21pbmdIdHRwSGVhZGVycyA9IHJlcy5oZWFkZXJzXG5cbiAgICBjb25zdCBzaXplSGVhZGVyVmFsdWUgPSByZXNIZWFkZXJzICYmIHJlc0hlYWRlcnNbJ2NvbnRlbnQtbGVuZ3RoJ11cbiAgICBjb25zdCBzaXplID0gdHlwZW9mIHNpemVIZWFkZXJWYWx1ZSA9PT0gJ251bWJlcicgPyBzaXplSGVhZGVyVmFsdWUgOiB1bmRlZmluZWRcblxuICAgIHJldHVybiB7XG4gICAgICBCdWNrZXQ6IGRlc3RDb25maWcuQnVja2V0LFxuICAgICAgS2V5OiBkZXN0Q29uZmlnLk9iamVjdCxcbiAgICAgIExhc3RNb2RpZmllZDogY29weVJlcy5sYXN0TW9kaWZpZWQsXG4gICAgICBNZXRhRGF0YTogZXh0cmFjdE1ldGFkYXRhKHJlc0hlYWRlcnMgYXMgUmVzcG9uc2VIZWFkZXIpLFxuICAgICAgVmVyc2lvbklkOiBnZXRWZXJzaW9uSWQocmVzSGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXG4gICAgICBTb3VyY2VWZXJzaW9uSWQ6IGdldFNvdXJjZVZlcnNpb25JZChyZXNIZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcbiAgICAgIEV0YWc6IHNhbml0aXplRVRhZyhyZXNIZWFkZXJzLmV0YWcpLFxuICAgICAgU2l6ZTogc2l6ZSxcbiAgICB9XG4gIH1cblxuICBhc3luYyBjb3B5T2JqZWN0KHNvdXJjZTogQ29weVNvdXJjZU9wdGlvbnMsIGRlc3Q6IENvcHlEZXN0aW5hdGlvbk9wdGlvbnMpOiBQcm9taXNlPENvcHlPYmplY3RSZXN1bHQ+XG4gIGFzeW5jIGNvcHlPYmplY3QoXG4gICAgdGFyZ2V0QnVja2V0TmFtZTogc3RyaW5nLFxuICAgIHRhcmdldE9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIGNvbmRpdGlvbnM/OiBDb3B5Q29uZGl0aW9ucyxcbiAgKTogUHJvbWlzZTxDb3B5T2JqZWN0UmVzdWx0PlxuICBhc3luYyBjb3B5T2JqZWN0KC4uLmFsbEFyZ3M6IENvcHlPYmplY3RQYXJhbXMpOiBQcm9taXNlPENvcHlPYmplY3RSZXN1bHQ+IHtcbiAgICBpZiAodHlwZW9mIGFsbEFyZ3NbMF0gPT09ICdzdHJpbmcnKSB7XG4gICAgICBjb25zdCBbdGFyZ2V0QnVja2V0TmFtZSwgdGFyZ2V0T2JqZWN0TmFtZSwgc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWUsIGNvbmRpdGlvbnNdID0gYWxsQXJncyBhcyBbXG4gICAgICAgIHN0cmluZyxcbiAgICAgICAgc3RyaW5nLFxuICAgICAgICBzdHJpbmcsXG4gICAgICAgIENvcHlDb25kaXRpb25zPyxcbiAgICAgIF1cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvcHlPYmplY3RWMSh0YXJnZXRCdWNrZXROYW1lLCB0YXJnZXRPYmplY3ROYW1lLCBzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSwgY29uZGl0aW9ucylcbiAgICB9XG4gICAgY29uc3QgW3NvdXJjZSwgZGVzdF0gPSBhbGxBcmdzIGFzIFtDb3B5U291cmNlT3B0aW9ucywgQ29weURlc3RpbmF0aW9uT3B0aW9uc11cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb3B5T2JqZWN0VjIoc291cmNlLCBkZXN0KVxuICB9XG5cbiAgYXN5bmMgdXBsb2FkUGFydChcbiAgICBwYXJ0Q29uZmlnOiB7XG4gICAgICBidWNrZXROYW1lOiBzdHJpbmdcbiAgICAgIG9iamVjdE5hbWU6IHN0cmluZ1xuICAgICAgdXBsb2FkSUQ6IHN0cmluZ1xuICAgICAgcGFydE51bWJlcjogbnVtYmVyXG4gICAgICBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVyc1xuICAgIH0sXG4gICAgcGF5bG9hZD86IEJpbmFyeSxcbiAgKSB7XG4gICAgY29uc3QgeyBidWNrZXROYW1lLCBvYmplY3ROYW1lLCB1cGxvYWRJRCwgcGFydE51bWJlciwgaGVhZGVycyB9ID0gcGFydENvbmZpZ1xuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBxdWVyeSA9IGB1cGxvYWRJZD0ke3VwbG9hZElEfSZwYXJ0TnVtYmVyPSR7cGFydE51bWJlcn1gXG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZTogb2JqZWN0TmFtZSwgcXVlcnksIGhlYWRlcnMgfVxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhyZXF1ZXN0T3B0aW9ucywgcGF5bG9hZClcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgICBjb25zdCBwYXJ0UmVzID0gdXBsb2FkUGFydFBhcnNlcihib2R5KVxuICAgIHJldHVybiB7XG4gICAgICBldGFnOiBzYW5pdGl6ZUVUYWcocGFydFJlcy5FVGFnKSxcbiAgICAgIGtleTogb2JqZWN0TmFtZSxcbiAgICAgIHBhcnQ6IHBhcnROdW1iZXIsXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgY29tcG9zZU9iamVjdChcbiAgICBkZXN0T2JqQ29uZmlnOiBDb3B5RGVzdGluYXRpb25PcHRpb25zLFxuICAgIHNvdXJjZU9iakxpc3Q6IENvcHlTb3VyY2VPcHRpb25zW10sXG4gICk6IFByb21pc2U8Ym9vbGVhbiB8IHsgZXRhZzogc3RyaW5nOyB2ZXJzaW9uSWQ6IHN0cmluZyB8IG51bGwgfSB8IFByb21pc2U8dm9pZD4gfCBDb3B5T2JqZWN0UmVzdWx0PiB7XG4gICAgY29uc3Qgc291cmNlRmlsZXNMZW5ndGggPSBzb3VyY2VPYmpMaXN0Lmxlbmd0aFxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHNvdXJjZU9iakxpc3QpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdzb3VyY2VDb25maWcgc2hvdWxkIGFuIGFycmF5IG9mIENvcHlTb3VyY2VPcHRpb25zICcpXG4gICAgfVxuICAgIGlmICghKGRlc3RPYmpDb25maWcgaW5zdGFuY2VvZiBDb3B5RGVzdGluYXRpb25PcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignZGVzdENvbmZpZyBzaG91bGQgb2YgdHlwZSBDb3B5RGVzdGluYXRpb25PcHRpb25zICcpXG4gICAgfVxuXG4gICAgaWYgKHNvdXJjZUZpbGVzTGVuZ3RoIDwgMSB8fCBzb3VyY2VGaWxlc0xlbmd0aCA+IFBBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRTX0NPVU5UKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICBgXCJUaGVyZSBtdXN0IGJlIGFzIGxlYXN0IG9uZSBhbmQgdXAgdG8gJHtQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVH0gc291cmNlIG9iamVjdHMuYCxcbiAgICAgIClcbiAgICB9XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHNvdXJjZUZpbGVzTGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IHNPYmogPSBzb3VyY2VPYmpMaXN0W2ldIGFzIENvcHlTb3VyY2VPcHRpb25zXG4gICAgICBpZiAoIXNPYmoudmFsaWRhdGUoKSkge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIShkZXN0T2JqQ29uZmlnIGFzIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMpLnZhbGlkYXRlKCkpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGNvbnN0IGdldFN0YXRPcHRpb25zID0gKHNyY0NvbmZpZzogQ29weVNvdXJjZU9wdGlvbnMpID0+IHtcbiAgICAgIGxldCBzdGF0T3B0cyA9IHt9XG4gICAgICBpZiAoIV8uaXNFbXB0eShzcmNDb25maWcuVmVyc2lvbklEKSkge1xuICAgICAgICBzdGF0T3B0cyA9IHtcbiAgICAgICAgICB2ZXJzaW9uSWQ6IHNyY0NvbmZpZy5WZXJzaW9uSUQsXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBzdGF0T3B0c1xuICAgIH1cbiAgICBjb25zdCBzcmNPYmplY3RTaXplczogbnVtYmVyW10gPSBbXVxuICAgIGxldCB0b3RhbFNpemUgPSAwXG4gICAgbGV0IHRvdGFsUGFydHMgPSAwXG5cbiAgICBjb25zdCBzb3VyY2VPYmpTdGF0cyA9IHNvdXJjZU9iakxpc3QubWFwKChzcmNJdGVtKSA9PlxuICAgICAgdGhpcy5zdGF0T2JqZWN0KHNyY0l0ZW0uQnVja2V0LCBzcmNJdGVtLk9iamVjdCwgZ2V0U3RhdE9wdGlvbnMoc3JjSXRlbSkpLFxuICAgIClcblxuICAgIGNvbnN0IHNyY09iamVjdEluZm9zID0gYXdhaXQgUHJvbWlzZS5hbGwoc291cmNlT2JqU3RhdHMpXG5cbiAgICBjb25zdCB2YWxpZGF0ZWRTdGF0cyA9IHNyY09iamVjdEluZm9zLm1hcCgocmVzSXRlbVN0YXQsIGluZGV4KSA9PiB7XG4gICAgICBjb25zdCBzcmNDb25maWc6IENvcHlTb3VyY2VPcHRpb25zIHwgdW5kZWZpbmVkID0gc291cmNlT2JqTGlzdFtpbmRleF1cblxuICAgICAgbGV0IHNyY0NvcHlTaXplID0gcmVzSXRlbVN0YXQuc2l6ZVxuICAgICAgLy8gQ2hlY2sgaWYgYSBzZWdtZW50IGlzIHNwZWNpZmllZCwgYW5kIGlmIHNvLCBpcyB0aGVcbiAgICAgIC8vIHNlZ21lbnQgd2l0aGluIG9iamVjdCBib3VuZHM/XG4gICAgICBpZiAoc3JjQ29uZmlnICYmIHNyY0NvbmZpZy5NYXRjaFJhbmdlKSB7XG4gICAgICAgIC8vIFNpbmNlIHJhbmdlIGlzIHNwZWNpZmllZCxcbiAgICAgICAgLy8gICAgMCA8PSBzcmMuc3JjU3RhcnQgPD0gc3JjLnNyY0VuZFxuICAgICAgICAvLyBzbyBvbmx5IGludmFsaWQgY2FzZSB0byBjaGVjayBpczpcbiAgICAgICAgY29uc3Qgc3JjU3RhcnQgPSBzcmNDb25maWcuU3RhcnRcbiAgICAgICAgY29uc3Qgc3JjRW5kID0gc3JjQ29uZmlnLkVuZFxuICAgICAgICBpZiAoc3JjRW5kID49IHNyY0NvcHlTaXplIHx8IHNyY1N0YXJ0IDwgMCkge1xuICAgICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgICAgICBgQ29weVNyY09wdGlvbnMgJHtpbmRleH0gaGFzIGludmFsaWQgc2VnbWVudC10by1jb3B5IFske3NyY1N0YXJ0fSwgJHtzcmNFbmR9XSAoc2l6ZSBpcyAke3NyY0NvcHlTaXplfSlgLFxuICAgICAgICAgIClcbiAgICAgICAgfVxuICAgICAgICBzcmNDb3B5U2l6ZSA9IHNyY0VuZCAtIHNyY1N0YXJ0ICsgMVxuICAgICAgfVxuXG4gICAgICAvLyBPbmx5IHRoZSBsYXN0IHNvdXJjZSBtYXkgYmUgbGVzcyB0aGFuIGBhYnNNaW5QYXJ0U2l6ZWBcbiAgICAgIGlmIChzcmNDb3B5U2l6ZSA8IFBBUlRfQ09OU1RSQUlOVFMuQUJTX01JTl9QQVJUX1NJWkUgJiYgaW5kZXggPCBzb3VyY2VGaWxlc0xlbmd0aCAtIDEpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgICBgQ29weVNyY09wdGlvbnMgJHtpbmRleH0gaXMgdG9vIHNtYWxsICgke3NyY0NvcHlTaXplfSkgYW5kIGl0IGlzIG5vdCB0aGUgbGFzdCBwYXJ0LmAsXG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgLy8gSXMgZGF0YSB0byBjb3B5IHRvbyBsYXJnZT9cbiAgICAgIHRvdGFsU2l6ZSArPSBzcmNDb3B5U2l6ZVxuICAgICAgaWYgKHRvdGFsU2l6ZSA+IFBBUlRfQ09OU1RSQUlOVFMuTUFYX01VTFRJUEFSVF9QVVRfT0JKRUNUX1NJWkUpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgQ2Fubm90IGNvbXBvc2UgYW4gb2JqZWN0IG9mIHNpemUgJHt0b3RhbFNpemV9ICg+IDVUaUIpYClcbiAgICAgIH1cblxuICAgICAgLy8gcmVjb3JkIHNvdXJjZSBzaXplXG4gICAgICBzcmNPYmplY3RTaXplc1tpbmRleF0gPSBzcmNDb3B5U2l6ZVxuXG4gICAgICAvLyBjYWxjdWxhdGUgcGFydHMgbmVlZGVkIGZvciBjdXJyZW50IHNvdXJjZVxuICAgICAgdG90YWxQYXJ0cyArPSBwYXJ0c1JlcXVpcmVkKHNyY0NvcHlTaXplKVxuICAgICAgLy8gRG8gd2UgbmVlZCBtb3JlIHBhcnRzIHRoYW4gd2UgYXJlIGFsbG93ZWQ/XG4gICAgICBpZiAodG90YWxQYXJ0cyA+IFBBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRTX0NPVU5UKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgICAgYFlvdXIgcHJvcG9zZWQgY29tcG9zZSBvYmplY3QgcmVxdWlyZXMgbW9yZSB0aGFuICR7UEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVFNfQ09VTlR9IHBhcnRzYCxcbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzSXRlbVN0YXRcbiAgICB9KVxuXG4gICAgaWYgKCh0b3RhbFBhcnRzID09PSAxICYmIHRvdGFsU2l6ZSA8PSBQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUX1NJWkUpIHx8IHRvdGFsU2l6ZSA9PT0gMCkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY29weU9iamVjdChzb3VyY2VPYmpMaXN0WzBdIGFzIENvcHlTb3VyY2VPcHRpb25zLCBkZXN0T2JqQ29uZmlnKSAvLyB1c2UgY29weU9iamVjdFYyXG4gICAgfVxuXG4gICAgLy8gcHJlc2VydmUgZXRhZyB0byBhdm9pZCBtb2RpZmljYXRpb24gb2Ygb2JqZWN0IHdoaWxlIGNvcHlpbmcuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzb3VyY2VGaWxlc0xlbmd0aDsgaSsrKSB7XG4gICAgICA7KHNvdXJjZU9iakxpc3RbaV0gYXMgQ29weVNvdXJjZU9wdGlvbnMpLk1hdGNoRVRhZyA9ICh2YWxpZGF0ZWRTdGF0c1tpXSBhcyBCdWNrZXRJdGVtU3RhdCkuZXRhZ1xuICAgIH1cblxuICAgIGNvbnN0IHNwbGl0UGFydFNpemVMaXN0ID0gdmFsaWRhdGVkU3RhdHMubWFwKChyZXNJdGVtU3RhdCwgaWR4KSA9PiB7XG4gICAgICByZXR1cm4gY2FsY3VsYXRlRXZlblNwbGl0cyhzcmNPYmplY3RTaXplc1tpZHhdIGFzIG51bWJlciwgc291cmNlT2JqTGlzdFtpZHhdIGFzIENvcHlTb3VyY2VPcHRpb25zKVxuICAgIH0pXG5cbiAgICBjb25zdCBnZXRVcGxvYWRQYXJ0Q29uZmlnTGlzdCA9ICh1cGxvYWRJZDogc3RyaW5nKSA9PiB7XG4gICAgICBjb25zdCB1cGxvYWRQYXJ0Q29uZmlnTGlzdDogVXBsb2FkUGFydENvbmZpZ1tdID0gW11cblxuICAgICAgc3BsaXRQYXJ0U2l6ZUxpc3QuZm9yRWFjaCgoc3BsaXRTaXplLCBzcGxpdEluZGV4OiBudW1iZXIpID0+IHtcbiAgICAgICAgaWYgKHNwbGl0U2l6ZSkge1xuICAgICAgICAgIGNvbnN0IHsgc3RhcnRJbmRleDogc3RhcnRJZHgsIGVuZEluZGV4OiBlbmRJZHgsIG9iakluZm86IG9iakNvbmZpZyB9ID0gc3BsaXRTaXplXG5cbiAgICAgICAgICBjb25zdCBwYXJ0SW5kZXggPSBzcGxpdEluZGV4ICsgMSAvLyBwYXJ0IGluZGV4IHN0YXJ0cyBmcm9tIDEuXG4gICAgICAgICAgY29uc3QgdG90YWxVcGxvYWRzID0gQXJyYXkuZnJvbShzdGFydElkeClcblxuICAgICAgICAgIGNvbnN0IGhlYWRlcnMgPSAoc291cmNlT2JqTGlzdFtzcGxpdEluZGV4XSBhcyBDb3B5U291cmNlT3B0aW9ucykuZ2V0SGVhZGVycygpXG5cbiAgICAgICAgICB0b3RhbFVwbG9hZHMuZm9yRWFjaCgoc3BsaXRTdGFydCwgdXBsZEN0cklkeCkgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc3BsaXRFbmQgPSBlbmRJZHhbdXBsZEN0cklkeF1cblxuICAgICAgICAgICAgY29uc3Qgc291cmNlT2JqID0gYCR7b2JqQ29uZmlnLkJ1Y2tldH0vJHtvYmpDb25maWcuT2JqZWN0fWBcbiAgICAgICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlJ10gPSBgJHtzb3VyY2VPYmp9YFxuICAgICAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtcmFuZ2UnXSA9IGBieXRlcz0ke3NwbGl0U3RhcnR9LSR7c3BsaXRFbmR9YFxuXG4gICAgICAgICAgICBjb25zdCB1cGxvYWRQYXJ0Q29uZmlnID0ge1xuICAgICAgICAgICAgICBidWNrZXROYW1lOiBkZXN0T2JqQ29uZmlnLkJ1Y2tldCxcbiAgICAgICAgICAgICAgb2JqZWN0TmFtZTogZGVzdE9iakNvbmZpZy5PYmplY3QsXG4gICAgICAgICAgICAgIHVwbG9hZElEOiB1cGxvYWRJZCxcbiAgICAgICAgICAgICAgcGFydE51bWJlcjogcGFydEluZGV4LFxuICAgICAgICAgICAgICBoZWFkZXJzOiBoZWFkZXJzLFxuICAgICAgICAgICAgICBzb3VyY2VPYmo6IHNvdXJjZU9iaixcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdXBsb2FkUGFydENvbmZpZ0xpc3QucHVzaCh1cGxvYWRQYXJ0Q29uZmlnKVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH0pXG5cbiAgICAgIHJldHVybiB1cGxvYWRQYXJ0Q29uZmlnTGlzdFxuICAgIH1cblxuICAgIGNvbnN0IHVwbG9hZEFsbFBhcnRzID0gYXN5bmMgKHVwbG9hZExpc3Q6IFVwbG9hZFBhcnRDb25maWdbXSkgPT4ge1xuICAgICAgY29uc3QgcGFydFVwbG9hZHMgPSB1cGxvYWRMaXN0Lm1hcChhc3luYyAoaXRlbSkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy51cGxvYWRQYXJ0KGl0ZW0pXG4gICAgICB9KVxuICAgICAgLy8gUHJvY2VzcyByZXN1bHRzIGhlcmUgaWYgbmVlZGVkXG4gICAgICByZXR1cm4gYXdhaXQgUHJvbWlzZS5hbGwocGFydFVwbG9hZHMpXG4gICAgfVxuXG4gICAgY29uc3QgcGVyZm9ybVVwbG9hZFBhcnRzID0gYXN5bmMgKHVwbG9hZElkOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbnN0IHVwbG9hZExpc3QgPSBnZXRVcGxvYWRQYXJ0Q29uZmlnTGlzdCh1cGxvYWRJZClcbiAgICAgIGNvbnN0IHBhcnRzUmVzID0gYXdhaXQgdXBsb2FkQWxsUGFydHModXBsb2FkTGlzdClcbiAgICAgIHJldHVybiBwYXJ0c1Jlcy5tYXAoKHBhcnRDb3B5KSA9PiAoeyBldGFnOiBwYXJ0Q29weS5ldGFnLCBwYXJ0OiBwYXJ0Q29weS5wYXJ0IH0pKVxuICAgIH1cblxuICAgIGNvbnN0IG5ld1VwbG9hZEhlYWRlcnMgPSBkZXN0T2JqQ29uZmlnLmdldEhlYWRlcnMoKVxuXG4gICAgY29uc3QgdXBsb2FkSWQgPSBhd2FpdCB0aGlzLmluaXRpYXRlTmV3TXVsdGlwYXJ0VXBsb2FkKGRlc3RPYmpDb25maWcuQnVja2V0LCBkZXN0T2JqQ29uZmlnLk9iamVjdCwgbmV3VXBsb2FkSGVhZGVycylcbiAgICB0cnkge1xuICAgICAgY29uc3QgcGFydHNEb25lID0gYXdhaXQgcGVyZm9ybVVwbG9hZFBhcnRzKHVwbG9hZElkKVxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY29tcGxldGVNdWx0aXBhcnRVcGxvYWQoZGVzdE9iakNvbmZpZy5CdWNrZXQsIGRlc3RPYmpDb25maWcuT2JqZWN0LCB1cGxvYWRJZCwgcGFydHNEb25lKVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuYWJvcnRNdWx0aXBhcnRVcGxvYWQoZGVzdE9iakNvbmZpZy5CdWNrZXQsIGRlc3RPYmpDb25maWcuT2JqZWN0LCB1cGxvYWRJZClcbiAgICB9XG4gIH1cblxuICBhc3luYyBwcmVzaWduZWRVcmwoXG4gICAgbWV0aG9kOiBzdHJpbmcsXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBleHBpcmVzPzogbnVtYmVyIHwgUHJlU2lnblJlcXVlc3RQYXJhbXMgfCB1bmRlZmluZWQsXG4gICAgcmVxUGFyYW1zPzogUHJlU2lnblJlcXVlc3RQYXJhbXMgfCBEYXRlLFxuICAgIHJlcXVlc3REYXRlPzogRGF0ZSxcbiAgKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBpZiAodGhpcy5hbm9ueW1vdXMpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuQW5vbnltb3VzUmVxdWVzdEVycm9yKGBQcmVzaWduZWQgJHttZXRob2R9IHVybCBjYW5ub3QgYmUgZ2VuZXJhdGVkIGZvciBhbm9ueW1vdXMgcmVxdWVzdHNgKVxuICAgIH1cblxuICAgIGlmICghZXhwaXJlcykge1xuICAgICAgZXhwaXJlcyA9IFBSRVNJR05fRVhQSVJZX0RBWVNfTUFYXG4gICAgfVxuICAgIGlmICghcmVxUGFyYW1zKSB7XG4gICAgICByZXFQYXJhbXMgPSB7fVxuICAgIH1cbiAgICBpZiAoIXJlcXVlc3REYXRlKSB7XG4gICAgICByZXF1ZXN0RGF0ZSA9IG5ldyBEYXRlKClcbiAgICB9XG5cbiAgICAvLyBUeXBlIGFzc2VydGlvbnNcbiAgICBpZiAoZXhwaXJlcyAmJiB0eXBlb2YgZXhwaXJlcyAhPT0gJ251bWJlcicpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2V4cGlyZXMgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuICAgIGlmIChyZXFQYXJhbXMgJiYgdHlwZW9mIHJlcVBhcmFtcyAhPT0gJ29iamVjdCcpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlcVBhcmFtcyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKChyZXF1ZXN0RGF0ZSAmJiAhKHJlcXVlc3REYXRlIGluc3RhbmNlb2YgRGF0ZSkpIHx8IChyZXF1ZXN0RGF0ZSAmJiBpc05hTihyZXF1ZXN0RGF0ZT8uZ2V0VGltZSgpKSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlcXVlc3REYXRlIHNob3VsZCBiZSBvZiB0eXBlIFwiRGF0ZVwiIGFuZCB2YWxpZCcpXG4gICAgfVxuXG4gICAgY29uc3QgcXVlcnkgPSByZXFQYXJhbXMgPyBxcy5zdHJpbmdpZnkocmVxUGFyYW1zKSA6IHVuZGVmaW5lZFxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlZ2lvbiA9IGF3YWl0IHRoaXMuZ2V0QnVja2V0UmVnaW9uQXN5bmMoYnVja2V0TmFtZSlcbiAgICAgIGF3YWl0IHRoaXMuY2hlY2tBbmRSZWZyZXNoQ3JlZHMoKVxuICAgICAgY29uc3QgcmVxT3B0aW9ucyA9IHRoaXMuZ2V0UmVxdWVzdE9wdGlvbnMoeyBtZXRob2QsIHJlZ2lvbiwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSlcblxuICAgICAgcmV0dXJuIHByZXNpZ25TaWduYXR1cmVWNChcbiAgICAgICAgcmVxT3B0aW9ucyxcbiAgICAgICAgdGhpcy5hY2Nlc3NLZXksXG4gICAgICAgIHRoaXMuc2VjcmV0S2V5LFxuICAgICAgICB0aGlzLnNlc3Npb25Ub2tlbixcbiAgICAgICAgcmVnaW9uLFxuICAgICAgICByZXF1ZXN0RGF0ZSxcbiAgICAgICAgZXhwaXJlcyxcbiAgICAgIClcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBVbmFibGUgdG8gZ2V0IGJ1Y2tldCByZWdpb24gZm9yICR7YnVja2V0TmFtZX0uYClcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcHJlc2lnbmVkR2V0T2JqZWN0KFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgZXhwaXJlcz86IG51bWJlcixcbiAgICByZXNwSGVhZGVycz86IFByZVNpZ25SZXF1ZXN0UGFyYW1zIHwgRGF0ZSxcbiAgICByZXF1ZXN0RGF0ZT86IERhdGUsXG4gICk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCB2YWxpZFJlc3BIZWFkZXJzID0gW1xuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtdHlwZScsXG4gICAgICAncmVzcG9uc2UtY29udGVudC1sYW5ndWFnZScsXG4gICAgICAncmVzcG9uc2UtZXhwaXJlcycsXG4gICAgICAncmVzcG9uc2UtY2FjaGUtY29udHJvbCcsXG4gICAgICAncmVzcG9uc2UtY29udGVudC1kaXNwb3NpdGlvbicsXG4gICAgICAncmVzcG9uc2UtY29udGVudC1lbmNvZGluZycsXG4gICAgXVxuICAgIHZhbGlkUmVzcEhlYWRlcnMuZm9yRWFjaCgoaGVhZGVyKSA9PiB7XG4gICAgICAvLyBAdHMtaWdub3JlXG4gICAgICBpZiAocmVzcEhlYWRlcnMgIT09IHVuZGVmaW5lZCAmJiByZXNwSGVhZGVyc1toZWFkZXJdICE9PSB1bmRlZmluZWQgJiYgIWlzU3RyaW5nKHJlc3BIZWFkZXJzW2hlYWRlcl0pKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYHJlc3BvbnNlIGhlYWRlciAke2hlYWRlcn0gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcImApXG4gICAgICB9XG4gICAgfSlcbiAgICByZXR1cm4gdGhpcy5wcmVzaWduZWRVcmwoJ0dFVCcsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGV4cGlyZXMsIHJlc3BIZWFkZXJzLCByZXF1ZXN0RGF0ZSlcbiAgfVxuXG4gIGFzeW5jIHByZXNpZ25lZFB1dE9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgZXhwaXJlcz86IG51bWJlcik6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5wcmVzaWduZWRVcmwoJ1BVVCcsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGV4cGlyZXMpXG4gIH1cblxuICBuZXdQb3N0UG9saWN5KCk6IFBvc3RQb2xpY3kge1xuICAgIHJldHVybiBuZXcgUG9zdFBvbGljeSgpXG4gIH1cblxuICBhc3luYyBwcmVzaWduZWRQb3N0UG9saWN5KHBvc3RQb2xpY3k6IFBvc3RQb2xpY3kpOiBQcm9taXNlPFBvc3RQb2xpY3lSZXN1bHQ+IHtcbiAgICBpZiAodGhpcy5hbm9ueW1vdXMpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuQW5vbnltb3VzUmVxdWVzdEVycm9yKCdQcmVzaWduZWQgUE9TVCBwb2xpY3kgY2Fubm90IGJlIGdlbmVyYXRlZCBmb3IgYW5vbnltb3VzIHJlcXVlc3RzJylcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChwb3N0UG9saWN5KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncG9zdFBvbGljeSBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgY29uc3QgYnVja2V0TmFtZSA9IHBvc3RQb2xpY3kuZm9ybURhdGEuYnVja2V0IGFzIHN0cmluZ1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZWdpb24gPSBhd2FpdCB0aGlzLmdldEJ1Y2tldFJlZ2lvbkFzeW5jKGJ1Y2tldE5hbWUpXG5cbiAgICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZSgpXG4gICAgICBjb25zdCBkYXRlU3RyID0gbWFrZURhdGVMb25nKGRhdGUpXG4gICAgICBhd2FpdCB0aGlzLmNoZWNrQW5kUmVmcmVzaENyZWRzKClcblxuICAgICAgaWYgKCFwb3N0UG9saWN5LnBvbGljeS5leHBpcmF0aW9uKSB7XG4gICAgICAgIC8vICdleHBpcmF0aW9uJyBpcyBtYW5kYXRvcnkgZmllbGQgZm9yIFMzLlxuICAgICAgICAvLyBTZXQgZGVmYXVsdCBleHBpcmF0aW9uIGRhdGUgb2YgNyBkYXlzLlxuICAgICAgICBjb25zdCBleHBpcmVzID0gbmV3IERhdGUoKVxuICAgICAgICBleHBpcmVzLnNldFNlY29uZHMoUFJFU0lHTl9FWFBJUllfREFZU19NQVgpXG4gICAgICAgIHBvc3RQb2xpY3kuc2V0RXhwaXJlcyhleHBpcmVzKVxuICAgICAgfVxuXG4gICAgICBwb3N0UG9saWN5LnBvbGljeS5jb25kaXRpb25zLnB1c2goWydlcScsICckeC1hbXotZGF0ZScsIGRhdGVTdHJdKVxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotZGF0ZSddID0gZGF0ZVN0clxuXG4gICAgICBwb3N0UG9saWN5LnBvbGljeS5jb25kaXRpb25zLnB1c2goWydlcScsICckeC1hbXotYWxnb3JpdGhtJywgJ0FXUzQtSE1BQy1TSEEyNTYnXSlcbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LWFsZ29yaXRobSddID0gJ0FXUzQtSE1BQy1TSEEyNTYnXG5cbiAgICAgIHBvc3RQb2xpY3kucG9saWN5LmNvbmRpdGlvbnMucHVzaChbJ2VxJywgJyR4LWFtei1jcmVkZW50aWFsJywgdGhpcy5hY2Nlc3NLZXkgKyAnLycgKyBnZXRTY29wZShyZWdpb24sIGRhdGUpXSlcbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LWNyZWRlbnRpYWwnXSA9IHRoaXMuYWNjZXNzS2V5ICsgJy8nICsgZ2V0U2NvcGUocmVnaW9uLCBkYXRlKVxuXG4gICAgICBpZiAodGhpcy5zZXNzaW9uVG9rZW4pIHtcbiAgICAgICAgcG9zdFBvbGljeS5wb2xpY3kuY29uZGl0aW9ucy5wdXNoKFsnZXEnLCAnJHgtYW16LXNlY3VyaXR5LXRva2VuJywgdGhpcy5zZXNzaW9uVG9rZW5dKVxuICAgICAgICBwb3N0UG9saWN5LmZvcm1EYXRhWyd4LWFtei1zZWN1cml0eS10b2tlbiddID0gdGhpcy5zZXNzaW9uVG9rZW5cbiAgICAgIH1cblxuICAgICAgY29uc3QgcG9saWN5QmFzZTY0ID0gQnVmZmVyLmZyb20oSlNPTi5zdHJpbmdpZnkocG9zdFBvbGljeS5wb2xpY3kpKS50b1N0cmluZygnYmFzZTY0JylcblxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YS5wb2xpY3kgPSBwb2xpY3lCYXNlNjRcblxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotc2lnbmF0dXJlJ10gPSBwb3N0UHJlc2lnblNpZ25hdHVyZVY0KHJlZ2lvbiwgZGF0ZSwgdGhpcy5zZWNyZXRLZXksIHBvbGljeUJhc2U2NClcbiAgICAgIGNvbnN0IG9wdHMgPSB7XG4gICAgICAgIHJlZ2lvbjogcmVnaW9uLFxuICAgICAgICBidWNrZXROYW1lOiBidWNrZXROYW1lLFxuICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlcU9wdGlvbnMgPSB0aGlzLmdldFJlcXVlc3RPcHRpb25zKG9wdHMpXG4gICAgICBjb25zdCBwb3J0U3RyID0gdGhpcy5wb3J0ID09IDgwIHx8IHRoaXMucG9ydCA9PT0gNDQzID8gJycgOiBgOiR7dGhpcy5wb3J0LnRvU3RyaW5nKCl9YFxuICAgICAgY29uc3QgdXJsU3RyID0gYCR7cmVxT3B0aW9ucy5wcm90b2NvbH0vLyR7cmVxT3B0aW9ucy5ob3N0fSR7cG9ydFN0cn0ke3JlcU9wdGlvbnMucGF0aH1gXG4gICAgICByZXR1cm4geyBwb3N0VVJMOiB1cmxTdHIsIGZvcm1EYXRhOiBwb3N0UG9saWN5LmZvcm1EYXRhIH1cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBVbmFibGUgdG8gZ2V0IGJ1Y2tldCByZWdpb24gZm9yICR7YnVja2V0TmFtZX0uYClcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuICB9XG4gIC8vIGxpc3QgYSBiYXRjaCBvZiBvYmplY3RzXG4gIGFzeW5jIGxpc3RPYmplY3RzUXVlcnkoYnVja2V0TmFtZTogc3RyaW5nLCBwcmVmaXg/OiBzdHJpbmcsIG1hcmtlcj86IHN0cmluZywgbGlzdFF1ZXJ5T3B0cz86IExpc3RPYmplY3RRdWVyeU9wdHMpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ByZWZpeCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhtYXJrZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtYXJrZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuXG4gICAgaWYgKGxpc3RRdWVyeU9wdHMgJiYgIWlzT2JqZWN0KGxpc3RRdWVyeU9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0UXVlcnlPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBsZXQgeyBEZWxpbWl0ZXIsIE1heEtleXMsIEluY2x1ZGVWZXJzaW9uIH0gPSBsaXN0UXVlcnlPcHRzIGFzIExpc3RPYmplY3RRdWVyeU9wdHNcblxuICAgIGlmICghaXNTdHJpbmcoRGVsaW1pdGVyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignRGVsaW1pdGVyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzTnVtYmVyKE1heEtleXMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdNYXhLZXlzIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJpZXMgPSBbXVxuICAgIC8vIGVzY2FwZSBldmVyeSB2YWx1ZSBpbiBxdWVyeSBzdHJpbmcsIGV4Y2VwdCBtYXhLZXlzXG4gICAgcXVlcmllcy5wdXNoKGBwcmVmaXg9JHt1cmlFc2NhcGUocHJlZml4KX1gKVxuICAgIHF1ZXJpZXMucHVzaChgZGVsaW1pdGVyPSR7dXJpRXNjYXBlKERlbGltaXRlcil9YClcbiAgICBxdWVyaWVzLnB1c2goYGVuY29kaW5nLXR5cGU9dXJsYClcblxuICAgIGlmIChJbmNsdWRlVmVyc2lvbikge1xuICAgICAgcXVlcmllcy5wdXNoKGB2ZXJzaW9uc2ApXG4gICAgfVxuXG4gICAgaWYgKG1hcmtlcikge1xuICAgICAgbWFya2VyID0gdXJpRXNjYXBlKG1hcmtlcilcbiAgICAgIGlmIChJbmNsdWRlVmVyc2lvbikge1xuICAgICAgICBxdWVyaWVzLnB1c2goYGtleS1tYXJrZXI9JHttYXJrZXJ9YClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHF1ZXJpZXMucHVzaChgbWFya2VyPSR7bWFya2VyfWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gbm8gbmVlZCB0byBlc2NhcGUgbWF4S2V5c1xuICAgIGlmIChNYXhLZXlzKSB7XG4gICAgICBpZiAoTWF4S2V5cyA+PSAxMDAwKSB7XG4gICAgICAgIE1heEtleXMgPSAxMDAwXG4gICAgICB9XG4gICAgICBxdWVyaWVzLnB1c2goYG1heC1rZXlzPSR7TWF4S2V5c31gKVxuICAgIH1cbiAgICBxdWVyaWVzLnNvcnQoKVxuICAgIGxldCBxdWVyeSA9ICcnXG4gICAgaWYgKHF1ZXJpZXMubGVuZ3RoID4gMCkge1xuICAgICAgcXVlcnkgPSBgJHtxdWVyaWVzLmpvaW4oJyYnKX1gXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0pXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gICAgY29uc3QgbGlzdFFyeUxpc3QgPSBwYXJzZUxpc3RPYmplY3RzKGJvZHkpXG4gICAgcmV0dXJuIGxpc3RRcnlMaXN0XG4gIH1cblxuICBsaXN0T2JqZWN0cyhcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgcHJlZml4Pzogc3RyaW5nLFxuICAgIHJlY3Vyc2l2ZT86IGJvb2xlYW4sXG4gICAgbGlzdE9wdHM/OiBMaXN0T2JqZWN0UXVlcnlPcHRzIHwgdW5kZWZpbmVkLFxuICApOiBCdWNrZXRTdHJlYW08T2JqZWN0SW5mbz4ge1xuICAgIGlmIChwcmVmaXggPT09IHVuZGVmaW5lZCkge1xuICAgICAgcHJlZml4ID0gJydcbiAgICB9XG4gICAgaWYgKHJlY3Vyc2l2ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZWN1cnNpdmUgPSBmYWxzZVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRQcmVmaXgocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkUHJlZml4RXJyb3IoYEludmFsaWQgcHJlZml4IDogJHtwcmVmaXh9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwcmVmaXggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNCb29sZWFuKHJlY3Vyc2l2ZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlY3Vyc2l2ZSBzaG91bGQgYmUgb2YgdHlwZSBcImJvb2xlYW5cIicpXG4gICAgfVxuICAgIGlmIChsaXN0T3B0cyAmJiAhaXNPYmplY3QobGlzdE9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0T3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgbGV0IG1hcmtlcjogc3RyaW5nIHwgdW5kZWZpbmVkID0gJydcbiAgICBjb25zdCBsaXN0UXVlcnlPcHRzID0ge1xuICAgICAgRGVsaW1pdGVyOiByZWN1cnNpdmUgPyAnJyA6ICcvJywgLy8gaWYgcmVjdXJzaXZlIGlzIGZhbHNlIHNldCBkZWxpbWl0ZXIgdG8gJy8nXG4gICAgICBNYXhLZXlzOiAxMDAwLFxuICAgICAgSW5jbHVkZVZlcnNpb246IGxpc3RPcHRzPy5JbmNsdWRlVmVyc2lvbixcbiAgICB9XG4gICAgbGV0IG9iamVjdHM6IE9iamVjdEluZm9bXSA9IFtdXG4gICAgbGV0IGVuZGVkID0gZmFsc2VcbiAgICBjb25zdCByZWFkU3RyZWFtOiBzdHJlYW0uUmVhZGFibGUgPSBuZXcgc3RyZWFtLlJlYWRhYmxlKHsgb2JqZWN0TW9kZTogdHJ1ZSB9KVxuICAgIHJlYWRTdHJlYW0uX3JlYWQgPSBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBwdXNoIG9uZSBvYmplY3QgcGVyIF9yZWFkKClcbiAgICAgIGlmIChvYmplY3RzLmxlbmd0aCkge1xuICAgICAgICByZWFkU3RyZWFtLnB1c2gob2JqZWN0cy5zaGlmdCgpKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICAgIGlmIChlbmRlZCkge1xuICAgICAgICByZXR1cm4gcmVhZFN0cmVhbS5wdXNoKG51bGwpXG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdDogTGlzdE9iamVjdFF1ZXJ5UmVzID0gYXdhaXQgdGhpcy5saXN0T2JqZWN0c1F1ZXJ5KGJ1Y2tldE5hbWUsIHByZWZpeCwgbWFya2VyLCBsaXN0UXVlcnlPcHRzKVxuICAgICAgICBpZiAocmVzdWx0LmlzVHJ1bmNhdGVkKSB7XG4gICAgICAgICAgbWFya2VyID0gcmVzdWx0Lm5leHRNYXJrZXIgfHwgcmVzdWx0LnZlcnNpb25JZE1hcmtlclxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGVuZGVkID0gdHJ1ZVxuICAgICAgICB9XG4gICAgICAgIGlmIChyZXN1bHQub2JqZWN0cykge1xuICAgICAgICAgIG9iamVjdHMgPSByZXN1bHQub2JqZWN0c1xuICAgICAgICB9XG4gICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgcmVhZFN0cmVhbS5fcmVhZCgpXG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgcmVhZFN0cmVhbS5lbWl0KCdlcnJvcicsIGVycilcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlYWRTdHJlYW1cbiAgfVxufVxuIl0sIm1hcHBpbmdzIjoiOzs7OztBQUFBLElBQUFBLE1BQUEsR0FBQUMsdUJBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFDLEVBQUEsR0FBQUYsdUJBQUEsQ0FBQUMsT0FBQTtBQUVBLElBQUFFLElBQUEsR0FBQUgsdUJBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFHLEtBQUEsR0FBQUosdUJBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFJLElBQUEsR0FBQUwsdUJBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFLLE1BQUEsR0FBQU4sdUJBQUEsQ0FBQUMsT0FBQTtBQUVBLElBQUFNLEtBQUEsR0FBQVAsdUJBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFPLFlBQUEsR0FBQVAsT0FBQTtBQUNBLElBQUFRLGNBQUEsR0FBQVIsT0FBQTtBQUNBLElBQUFTLE9BQUEsR0FBQVQsT0FBQTtBQUNBLElBQUFVLEVBQUEsR0FBQVgsdUJBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFXLE9BQUEsR0FBQVgsT0FBQTtBQUVBLElBQUFZLG1CQUFBLEdBQUFaLE9BQUE7QUFDQSxJQUFBYSxNQUFBLEdBQUFkLHVCQUFBLENBQUFDLE9BQUE7QUFFQSxJQUFBYyxRQUFBLEdBQUFkLE9BQUE7QUFVQSxJQUFBZSxRQUFBLEdBQUFmLE9BQUE7QUFDQSxJQUFBZ0IsT0FBQSxHQUFBaEIsT0FBQTtBQUNBLElBQUFpQixlQUFBLEdBQUFqQixPQUFBO0FBQ0EsSUFBQWtCLFdBQUEsR0FBQWxCLE9BQUE7QUFDQSxJQUFBbUIsT0FBQSxHQUFBbkIsT0FBQTtBQWtDQSxJQUFBb0IsYUFBQSxHQUFBcEIsT0FBQTtBQUNBLElBQUFx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