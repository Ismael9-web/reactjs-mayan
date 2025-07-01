"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.calculateEvenSplits = calculateEvenSplits;
exports.extractMetadata = extractMetadata;
exports.getContentLength = getContentLength;
exports.getEncryptionHeaders = getEncryptionHeaders;
exports.getScope = getScope;
exports.getSourceVersionId = getSourceVersionId;
exports.getVersionId = getVersionId;
exports.hashBinary = hashBinary;
exports.insertContentType = insertContentType;
exports.isAmazonEndpoint = isAmazonEndpoint;
exports.isAmzHeader = isAmzHeader;
exports.isBoolean = isBoolean;
exports.isDefined = isDefined;
exports.isEmpty = isEmpty;
exports.isEmptyObject = isEmptyObject;
exports.isFunction = isFunction;
exports.isNumber = isNumber;
exports.isObject = isObject;
exports.isReadableStream = isReadableStream;
exports.isStorageClassHeader = isStorageClassHeader;
exports.isString = isString;
exports.isSupportedHeader = isSupportedHeader;
exports.isValidBucketName = isValidBucketName;
exports.isValidDate = isValidDate;
exports.isValidDomain = isValidDomain;
exports.isValidEndpoint = isValidEndpoint;
exports.isValidIP = isValidIP;
exports.isValidObjectName = isValidObjectName;
exports.isValidPort = isValidPort;
exports.isValidPrefix = isValidPrefix;
exports.isVirtualHostStyle = isVirtualHostStyle;
exports.makeDateLong = makeDateLong;
exports.makeDateShort = makeDateShort;
exports.parseXml = parseXml;
exports.partsRequired = partsRequired;
exports.pipesetup = pipesetup;
exports.prependXAMZMeta = prependXAMZMeta;
exports.probeContentType = probeContentType;
exports.readableStream = readableStream;
exports.sanitizeETag = sanitizeETag;
exports.sanitizeObjectKey = sanitizeObjectKey;
exports.sanitizeSize = sanitizeSize;
exports.toArray = toArray;
exports.toMd5 = toMd5;
exports.toSha256 = toSha256;
exports.uriEscape = uriEscape;
exports.uriResourceEscape = uriResourceEscape;
var crypto = _interopRequireWildcard(require("crypto"), true);
var stream = _interopRequireWildcard(require("stream"), true);
var _fastXmlParser = require("fast-xml-parser");
var _ipaddr = require("ipaddr.js");
var _lodash = require("lodash");
var mime = _interopRequireWildcard(require("mime-types"), true);
var _async = require("./async.js");
var _type = require("./type.js");
function _getRequireWildcardCache(nodeInterop) { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap(); var cacheNodeInterop = new WeakMap(); return (_getRequireWildcardCache = function (nodeInterop) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); }
function _interopRequireWildcard(obj, nodeInterop) { if (!nodeInterop && obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }
/*
 * MinIO Javascript Library for Amazon S3 Compatible Cloud Storage, (C) 2015 MinIO, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const MetaDataHeaderPrefix = 'x-amz-meta-';
function hashBinary(buf, enableSHA256) {
  let sha256sum = '';
  if (enableSHA256) {
    sha256sum = crypto.createHash('sha256').update(buf).digest('hex');
  }
  const md5sum = crypto.createHash('md5').update(buf).digest('base64');
  return {
    md5sum,
    sha256sum
  };
}

// S3 percent-encodes some extra non-standard characters in a URI . So comply with S3.
const encodeAsHex = c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`;
function uriEscape(uriStr) {
  return encodeURIComponent(uriStr).replace(/[!'()*]/g, encodeAsHex);
}
function uriResourceEscape(string) {
  return uriEscape(string).replace(/%2F/g, '/');
}
function getScope(region, date, serviceName = 's3') {
  return `${makeDateShort(date)}/${region}/${serviceName}/aws4_request`;
}

/**
 * isAmazonEndpoint - true if endpoint is 's3.amazonaws.com' or 's3.cn-north-1.amazonaws.com.cn'
 */
function isAmazonEndpoint(endpoint) {
  return endpoint === 's3.amazonaws.com' || endpoint === 's3.cn-north-1.amazonaws.com.cn';
}

/**
 * isVirtualHostStyle - verify if bucket name is support with virtual
 * hosts. bucketNames with periods should be always treated as path
 * style if the protocol is 'https:', this is due to SSL wildcard
 * limitation. For all other buckets and Amazon S3 endpoint we will
 * default to virtual host style.
 */
function isVirtualHostStyle(endpoint, protocol, bucket, pathStyle) {
  if (protocol === 'https:' && bucket.includes('.')) {
    return false;
  }
  return isAmazonEndpoint(endpoint) || !pathStyle;
}
function isValidIP(ip) {
  return _ipaddr.isValid(ip);
}

/**
 * @returns if endpoint is valid domain.
 */
function isValidEndpoint(endpoint) {
  return isValidDomain(endpoint) || isValidIP(endpoint);
}

/**
 * @returns if input host is a valid domain.
 */
function isValidDomain(host) {
  if (!isString(host)) {
    return false;
  }
  // See RFC 1035, RFC 3696.
  if (host.length === 0 || host.length > 255) {
    return false;
  }
  // Host cannot start or end with a '-'
  if (host[0] === '-' || host.slice(-1) === '-') {
    return false;
  }
  // Host cannot start or end with a '_'
  if (host[0] === '_' || host.slice(-1) === '_') {
    return false;
  }
  // Host cannot start with a '.'
  if (host[0] === '.') {
    return false;
  }
  const nonAlphaNumerics = '`~!@#$%^&*()+={}[]|\\"\';:><?/';
  // All non alphanumeric characters are invalid.
  for (const char of nonAlphaNumerics) {
    if (host.includes(char)) {
      return false;
    }
  }
  // No need to regexp match, since the list is non-exhaustive.
  // We let it be valid and fail later.
  return true;
}

/**
 * Probes contentType using file extensions.
 *
 * @example
 * ```
 * // return 'image/png'
 * probeContentType('file.png')
 * ```
 */
function probeContentType(path) {
  let contentType = mime.lookup(path);
  if (!contentType) {
    contentType = 'application/octet-stream';
  }
  return contentType;
}

/**
 * is input port valid.
 */
function isValidPort(port) {
  // Convert string port to number if needed
  const portNum = typeof port === 'string' ? parseInt(port, 10) : port;

  // verify if port is a valid number
  if (!isNumber(portNum) || isNaN(portNum)) {
    return false;
  }

  // port `0` is valid and special case
  return 0 <= portNum && portNum <= 65535;
}
function isValidBucketName(bucket) {
  if (!isString(bucket)) {
    return false;
  }

  // bucket length should be less than and no more than 63
  // characters long.
  if (bucket.length < 3 || bucket.length > 63) {
    return false;
  }
  // bucket with successive periods is invalid.
  if (bucket.includes('..')) {
    return false;
  }
  // bucket cannot have ip address style.
  if (/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/.test(bucket)) {
    return false;
  }
  // bucket should begin with alphabet/number and end with alphabet/number,
  // with alphabet/number/.- in the middle.
  if (/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/.test(bucket)) {
    return true;
  }
  return false;
}

/**
 * check if objectName is a valid object name
 */
function isValidObjectName(objectName) {
  if (!isValidPrefix(objectName)) {
    return false;
  }
  return objectName.length !== 0;
}

/**
 * check if prefix is valid
 */
function isValidPrefix(prefix) {
  if (!isString(prefix)) {
    return false;
  }
  if (prefix.length > 1024) {
    return false;
  }
  return true;
}

/**
 * check if typeof arg number
 */
function isNumber(arg) {
  return typeof arg === 'number';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any

/**
 * check if typeof arg function
 */
function isFunction(arg) {
  return typeof arg === 'function';
}

/**
 * check if typeof arg string
 */
function isString(arg) {
  return typeof arg === 'string';
}

/**
 * check if typeof arg object
 */
function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

/**
 * check if object is readable stream
 */
function isReadableStream(arg) {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  return isObject(arg) && isFunction(arg._read);
}

/**
 * check if arg is boolean
 */
function isBoolean(arg) {
  return typeof arg === 'boolean';
}
function isEmpty(o) {
  return _lodash.isEmpty(o);
}
function isEmptyObject(o) {
  return Object.values(o).filter(x => x !== undefined).length !== 0;
}
function isDefined(o) {
  return o !== null && o !== undefined;
}

/**
 * check if arg is a valid date
 */
function isValidDate(arg) {
  // @ts-expect-error checknew Date(Math.NaN)
  return arg instanceof Date && !isNaN(arg);
}

/**
 * Create a Date string with format: 'YYYYMMDDTHHmmss' + Z
 */
function makeDateLong(date) {
  date = date || new Date();

  // Gives format like: '2017-08-07T16:28:59.889Z'
  const s = date.toISOString();
  return s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 13) + s.slice(14, 16) + s.slice(17, 19) + 'Z';
}

/**
 * Create a Date string with format: 'YYYYMMDD'
 */
function makeDateShort(date) {
  date = date || new Date();

  // Gives format like: '2017-08-07T16:28:59.889Z'
  const s = date.toISOString();
  return s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 10);
}

/**
 * pipesetup sets up pipe() from left to right os streams array
 * pipesetup will also make sure that error emitted at any of the upstream Stream
 * will be emitted at the last stream. This makes error handling simple
 */
function pipesetup(...streams) {
  // @ts-expect-error ts can't narrow this
  return streams.reduce((src, dst) => {
    src.on('error', err => dst.emit('error', err));
    return src.pipe(dst);
  });
}

/**
 * return a Readable stream that emits data
 */
function readableStream(data) {
  const s = new stream.Readable();
  s._read = () => {};
  s.push(data);
  s.push(null);
  return s;
}

/**
 * Process metadata to insert appropriate value to `content-type` attribute
 */
function insertContentType(metaData, filePath) {
  // check if content-type attribute present in metaData
  for (const key in metaData) {
    if (key.toLowerCase() === 'content-type') {
      return metaData;
    }
  }

  // if `content-type` attribute is not present in metadata, then infer it from the extension in filePath
  return {
    ...metaData,
    'content-type': probeContentType(filePath)
  };
}

/**
 * Function prepends metadata with the appropriate prefix if it is not already on
 */
function prependXAMZMeta(metaData) {
  if (!metaData) {
    return {};
  }
  return _lodash.mapKeys(metaData, (value, key) => {
    if (isAmzHeader(key) || isSupportedHeader(key) || isStorageClassHeader(key)) {
      return key;
    }
    return MetaDataHeaderPrefix + key;
  });
}

/**
 * Checks if it is a valid header according to the AmazonS3 API
 */
function isAmzHeader(key) {
  const temp = key.toLowerCase();
  return temp.startsWith(MetaDataHeaderPrefix) || temp === 'x-amz-acl' || temp.startsWith('x-amz-server-side-encryption-') || temp === 'x-amz-server-side-encryption';
}

/**
 * Checks if it is a supported Header
 */
function isSupportedHeader(key) {
  const supported_headers = ['content-type', 'cache-control', 'content-encoding', 'content-disposition', 'content-language', 'x-amz-website-redirect-location', 'if-none-match', 'if-match'];
  return supported_headers.includes(key.toLowerCase());
}

/**
 * Checks if it is a storage header
 */
function isStorageClassHeader(key) {
  return key.toLowerCase() === 'x-amz-storage-class';
}
function extractMetadata(headers) {
  return _lodash.mapKeys(_lodash.pickBy(headers, (value, key) => isSupportedHeader(key) || isStorageClassHeader(key) || isAmzHeader(key)), (value, key) => {
    const lower = key.toLowerCase();
    if (lower.startsWith(MetaDataHeaderPrefix)) {
      return lower.slice(MetaDataHeaderPrefix.length);
    }
    return key;
  });
}
function getVersionId(headers = {}) {
  return headers['x-amz-version-id'] || null;
}
function getSourceVersionId(headers = {}) {
  return headers['x-amz-copy-source-version-id'] || null;
}
function sanitizeETag(etag = '') {
  const replaceChars = {
    '"': '',
    '&quot;': '',
    '&#34;': '',
    '&QUOT;': '',
    '&#x00022': ''
  };
  return etag.replace(/^("|&quot;|&#34;)|("|&quot;|&#34;)$/g, m => replaceChars[m]);
}
function toMd5(payload) {
  // use string from browser and buffer from nodejs
  // browser support is tested only against minio server
  return crypto.createHash('md5').update(Buffer.from(payload)).digest().toString('base64');
}
function toSha256(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * toArray returns a single element array with param being the element,
 * if param is just a string, and returns 'param' back if it is an array
 * So, it makes sure param is always an array
 */
function toArray(param) {
  if (!Array.isArray(param)) {
    return [param];
  }
  return param;
}
function sanitizeObjectKey(objectName) {
  // + symbol characters are not decoded as spaces in JS. so replace them first and decode to get the correct result.
  const asStrName = (objectName ? objectName.toString() : '').replace(/\+/g, ' ');
  return decodeURIComponent(asStrName);
}
function sanitizeSize(size) {
  return size ? Number.parseInt(size) : undefined;
}
const PART_CONSTRAINTS = {
  // absMinPartSize - absolute minimum part size (5 MiB)
  ABS_MIN_PART_SIZE: 1024 * 1024 * 5,
  // MIN_PART_SIZE - minimum part size 16MiB per object after which
  MIN_PART_SIZE: 1024 * 1024 * 16,
  // MAX_PARTS_COUNT - maximum number of parts for a single multipart session.
  MAX_PARTS_COUNT: 10000,
  // MAX_PART_SIZE - maximum part size 5GiB for a single multipart upload
  // operation.
  MAX_PART_SIZE: 1024 * 1024 * 1024 * 5,
  // MAX_SINGLE_PUT_OBJECT_SIZE - maximum size 5GiB of object per PUT
  // operation.
  MAX_SINGLE_PUT_OBJECT_SIZE: 1024 * 1024 * 1024 * 5,
  // MAX_MULTIPART_PUT_OBJECT_SIZE - maximum size 5TiB of object for
  // Multipart operation.
  MAX_MULTIPART_PUT_OBJECT_SIZE: 1024 * 1024 * 1024 * 1024 * 5
};
exports.PART_CONSTRAINTS = PART_CONSTRAINTS;
const GENERIC_SSE_HEADER = 'X-Amz-Server-Side-Encryption';
const ENCRYPTION_HEADERS = {
  // sseGenericHeader is the AWS SSE header used for SSE-S3 and SSE-KMS.
  sseGenericHeader: GENERIC_SSE_HEADER,
  // sseKmsKeyID is the AWS SSE-KMS key id.
  sseKmsKeyID: GENERIC_SSE_HEADER + '-Aws-Kms-Key-Id'
};

/**
 * Return Encryption headers
 * @param encConfig
 * @returns an object with key value pairs that can be used in headers.
 */
function getEncryptionHeaders(encConfig) {
  const encType = encConfig.type;
  if (!isEmpty(encType)) {
    if (encType === _type.ENCRYPTION_TYPES.SSEC) {
      return {
        [ENCRYPTION_HEADERS.sseGenericHeader]: 'AES256'
      };
    } else if (encType === _type.ENCRYPTION_TYPES.KMS) {
      return {
        [ENCRYPTION_HEADERS.sseGenericHeader]: encConfig.SSEAlgorithm,
        [ENCRYPTION_HEADERS.sseKmsKeyID]: encConfig.KMSMasterKeyID
      };
    }
  }
  return {};
}
function partsRequired(size) {
  const maxPartSize = PART_CONSTRAINTS.MAX_MULTIPART_PUT_OBJECT_SIZE / (PART_CONSTRAINTS.MAX_PARTS_COUNT - 1);
  let requiredPartSize = size / maxPartSize;
  if (size % maxPartSize > 0) {
    requiredPartSize++;
  }
  requiredPartSize = Math.trunc(requiredPartSize);
  return requiredPartSize;
}

/**
 * calculateEvenSplits - computes splits for a source and returns
 * start and end index slices. Splits happen evenly to be sure that no
 * part is less than 5MiB, as that could fail the multipart request if
 * it is not the last part.
 */
function calculateEvenSplits(size, objInfo) {
  if (size === 0) {
    return null;
  }
  const reqParts = partsRequired(size);
  const startIndexParts = [];
  const endIndexParts = [];
  let start = objInfo.Start;
  if (isEmpty(start) || start === -1) {
    start = 0;
  }
  const divisorValue = Math.trunc(size / reqParts);
  const reminderValue = size % reqParts;
  let nextStart = start;
  for (let i = 0; i < reqParts; i++) {
    let curPartSize = divisorValue;
    if (i < reminderValue) {
      curPartSize++;
    }
    const currentStart = nextStart;
    const currentEnd = currentStart + curPartSize - 1;
    nextStart = currentEnd + 1;
    startIndexParts.push(currentStart);
    endIndexParts.push(currentEnd);
  }
  return {
    startIndex: startIndexParts,
    endIndex: endIndexParts,
    objInfo: objInfo
  };
}
const fxp = new _fastXmlParser.XMLParser({
  numberParseOptions: {
    eNotation: false,
    hex: true,
    leadingZeros: true
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseXml(xml) {
  const result = fxp.parse(xml);
  if (result.Error) {
    throw result.Error;
  }
  return result;
}

/**
 * get content size of object content to upload
 */
async function getContentLength(s) {
  // use length property of string | Buffer
  if (typeof s === 'string' || Buffer.isBuffer(s)) {
    return s.length;
  }

  // property of `fs.ReadStream`
  const filePath = s.path;
  if (filePath && typeof filePath === 'string') {
    const stat = await _async.fsp.lstat(filePath);
    return stat.size;
  }

  // property of `fs.ReadStream`
  const fd = s.fd;
  if (fd && typeof fd === 'number') {
    const stat = await (0, _async.fstat)(fd);
    return stat.size;
  }
  return null;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcnlwdG8iLCJfaW50ZXJvcFJlcXVpcmVXaWxkY2FyZCIsInJlcXVpcmUiLCJzdHJlYW0iLCJfZmFzdFhtbFBhcnNlciIsIl9pcGFkZHIiLCJfbG9kYXNoIiwibWltZSIsIl9hc3luYyIsIl90eXBlIiwiX2dldFJlcXVpcmVXaWxkY2FyZENhY2hlIiwibm9kZUludGVyb3AiLCJXZWFrTWFwIiwiY2FjaGVCYWJlbEludGVyb3AiLCJjYWNoZU5vZGVJbnRlcm9wIiwib2JqIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJjYWNoZSIsImhhcyIsImdldCIsIm5ld09iaiIsImhhc1Byb3BlcnR5RGVzY3JpcHRvciIsIk9iamVjdCIsImRlZmluZVByb3BlcnR5IiwiZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yIiwia2V5IiwicHJvdG90eXBlIiwiaGFzT3duUHJvcGVydHkiLCJjYWxsIiwiZGVzYyIsInNldCIsIk1ldGFEYXRhSGVhZGVyUHJlZml4IiwiaGFzaEJpbmFyeSIsImJ1ZiIsImVuYWJsZVNIQTI1NiIsInNoYTI1NnN1bSIsImNyZWF0ZUhhc2giLCJ1cGRhdGUiLCJkaWdlc3QiLCJtZDVzdW0iLCJlbmNvZGVBc0hleCIsImMiLCJjaGFyQ29kZUF0IiwidG9TdHJpbmciLCJ0b1VwcGVyQ2FzZSIsInVyaUVzY2FwZSIsInVyaVN0ciIsImVuY29kZVVSSUNvbXBvbmVudCIsInJlcGxhY2UiLCJ1cmlSZXNvdXJjZUVzY2FwZSIsInN0cmluZyIsImdldFNjb3BlIiwicmVnaW9uIiwiZGF0ZSIsInNlcnZpY2VOYW1lIiwibWFrZURhdGVTaG9ydCIsImlzQW1hem9uRW5kcG9pbnQiLCJlbmRwb2ludCIsImlzVmlydHVhbEhvc3RTdHlsZSIsInByb3RvY29sIiwiYnVja2V0IiwicGF0aFN0eWxlIiwiaW5jbHVkZXMiLCJpc1ZhbGlkSVAiLCJpcCIsImlwYWRkciIsImlzVmFsaWQiLCJpc1ZhbGlkRW5kcG9pbnQiLCJpc1ZhbGlkRG9tYWluIiwiaG9zdCIsImlzU3RyaW5nIiwibGVuZ3RoIiwic2xpY2UiLCJub25BbHBoYU51bWVyaWNzIiwiY2hhciIsInByb2JlQ29udGVudFR5cGUiLCJwYXRoIiwiY29udGVudFR5cGUiLCJsb29rdXAiLCJpc1ZhbGlkUG9ydCIsInBvcnQiLCJwb3J0TnVtIiwicGFyc2VJbnQiLCJpc051bWJlciIsImlzTmFOIiwiaXNWYWxpZEJ1Y2tldE5hbWUiLCJ0ZXN0IiwiaXNWYWxpZE9iamVjdE5hbWUiLCJvYmplY3ROYW1lIiwiaXNWYWxpZFByZWZpeCIsInByZWZpeCIsImFyZyIsImlzRnVuY3Rpb24iLCJpc09iamVjdCIsImlzUmVhZGFibGVTdHJlYW0iLCJfcmVhZCIsImlzQm9vbGVhbiIsImlzRW1wdHkiLCJvIiwiXyIsImlzRW1wdHlPYmplY3QiLCJ2YWx1ZXMiLCJmaWx0ZXIiLCJ4IiwidW5kZWZpbmVkIiwiaXNEZWZpbmVkIiwiaXNWYWxpZERhdGUiLCJEYXRlIiwibWFrZURhdGVMb25nIiwicyIsInRvSVNPU3RyaW5nIiwicGlwZXNldHVwIiwic3RyZWFtcyIsInJlZHVjZSIsInNyYyIsImRzdCIsIm9uIiwiZXJyIiwiZW1pdCIsInBpcGUiLCJyZWFkYWJsZVN0cmVhbSIsImRhdGEiLCJSZWFkYWJsZSIsInB1c2giLCJpbnNlcnRDb250ZW50VHlwZSIsIm1ldGFEYXRhIiwiZmlsZVBhdGgiLCJ0b0xvd2VyQ2FzZSIsInByZXBlbmRYQU1aTWV0YSIsIm1hcEtleXMiLCJ2YWx1ZSIsImlzQW16SGVhZGVyIiwiaXNTdXBwb3J0ZWRIZWFkZXIiLCJpc1N0b3JhZ2VDbGFzc0hlYWRlciIsInRlbXAiLCJzdGFydHNXaXRoIiwic3VwcG9ydGVkX2hlYWRlcnMiLCJleHRyYWN0TWV0YWRhdGEiLCJoZWFkZXJzIiwicGlja0J5IiwibG93ZXIiLCJnZXRWZXJzaW9uSWQiLCJnZXRTb3VyY2VWZXJzaW9uSWQiLCJzYW5pdGl6ZUVUYWciLCJldGFnIiwicmVwbGFjZUNoYXJzIiwibSIsInRvTWQ1IiwicGF5bG9hZCIsIkJ1ZmZlciIsImZyb20iLCJ0b1NoYTI1NiIsInRvQXJyYXkiLCJwYXJhbSIsIkFycmF5IiwiaXNBcnJheSIsInNhbml0aXplT2JqZWN0S2V5IiwiYXNTdHJOYW1lIiwiZGVjb2RlVVJJQ29tcG9uZW50Iiwic2FuaXRpemVTaXplIiwic2l6ZSIsIk51bWJlciIsIlBBUlRfQ09OU1RSQUlOVFMiLCJBQlNfTUlOX1BBUlRfU0laRSIsIk1JTl9QQVJUX1NJWkUiLCJNQVhfUEFSVFNfQ09VTlQiLCJNQVhfUEFSVF9TSVpFIiwiTUFYX1NJTkdMRV9QVVRfT0JKRUNUX1NJWkUiLCJNQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSIsImV4cG9ydHMiLCJHRU5FUklDX1NTRV9IRUFERVIiLCJFTkNSWVBUSU9OX0hFQURFUlMiLCJzc2VHZW5lcmljSGVhZGVyIiwic3NlS21zS2V5SUQiLCJnZXRFbmNyeXB0aW9uSGVhZGVycyIsImVuY0NvbmZpZyIsImVuY1R5cGUiLCJ0eXBlIiwiRU5DUllQVElPTl9UWVBFUyIsIlNTRUMiLCJLTVMiLCJTU0VBbGdvcml0aG0iLCJLTVNNYXN0ZXJLZXlJRCIsInBhcnRzUmVxdWlyZWQiLCJtYXhQYXJ0U2l6ZSIsInJlcXVpcmVkUGFydFNpemUiLCJNYXRoIiwidHJ1bmMiLCJjYWxjdWxhdGVFdmVuU3BsaXRzIiwib2JqSW5mbyIsInJlcVBhcnRzIiwic3RhcnRJbmRleFBhcnRzIiwiZW5kSW5kZXhQYXJ0cyIsInN0YXJ0IiwiU3RhcnQiLCJkaXZpc29yVmFsdWUiLCJyZW1pbmRlclZhbHVlIiwibmV4dFN0YXJ0IiwiaSIsImN1clBhcnRTaXplIiwiY3VycmVudFN0YXJ0IiwiY3VycmVudEVuZCIsInN0YXJ0SW5kZXgiLCJlbmRJbmRleCIsImZ4cCIsIlhNTFBhcnNlciIsIm51bWJlclBhcnNlT3B0aW9ucyIsImVOb3RhdGlvbiIsImhleCIsImxlYWRpbmdaZXJvcyIsInBhcnNlWG1sIiwieG1sIiwicmVzdWx0IiwicGFyc2UiLCJFcnJvciIsImdldENvbnRlbnRMZW5ndGgiLCJpc0J1ZmZlciIsInN0YXQiLCJmc3AiLCJsc3RhdCIsImZkIiwiZnN0YXQiXSwic291cmNlcyI6WyJoZWxwZXIudHMiXSwic291cmNlc0NvbnRlbnQiOlsiLypcbiAqIE1pbklPIEphdmFzY3JpcHQgTGlicmFyeSBmb3IgQW1hem9uIFMzIENvbXBhdGlibGUgQ2xvdWQgU3RvcmFnZSwgKEMpIDIwMTUgTWluSU8sIEluYy5cbiAqXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuICogeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4gKlxuICogICAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKi9cblxuaW1wb3J0ICogYXMgY3J5cHRvIGZyb20gJ25vZGU6Y3J5cHRvJ1xuaW1wb3J0ICogYXMgc3RyZWFtIGZyb20gJ25vZGU6c3RyZWFtJ1xuXG5pbXBvcnQgeyBYTUxQYXJzZXIgfSBmcm9tICdmYXN0LXhtbC1wYXJzZXInXG5pbXBvcnQgaXBhZGRyIGZyb20gJ2lwYWRkci5qcydcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCdcbmltcG9ydCAqIGFzIG1pbWUgZnJvbSAnbWltZS10eXBlcydcblxuaW1wb3J0IHsgZnNwLCBmc3RhdCB9IGZyb20gJy4vYXN5bmMudHMnXG5pbXBvcnQgdHlwZSB7IEJpbmFyeSwgRW5jcnlwdGlvbiwgT2JqZWN0TWV0YURhdGEsIFJlcXVlc3RIZWFkZXJzLCBSZXNwb25zZUhlYWRlciB9IGZyb20gJy4vdHlwZS50cydcbmltcG9ydCB7IEVOQ1JZUFRJT05fVFlQRVMgfSBmcm9tICcuL3R5cGUudHMnXG5cbmNvbnN0IE1ldGFEYXRhSGVhZGVyUHJlZml4ID0gJ3gtYW16LW1ldGEtJ1xuXG5leHBvcnQgZnVuY3Rpb24gaGFzaEJpbmFyeShidWY6IEJ1ZmZlciwgZW5hYmxlU0hBMjU2OiBib29sZWFuKSB7XG4gIGxldCBzaGEyNTZzdW0gPSAnJ1xuICBpZiAoZW5hYmxlU0hBMjU2KSB7XG4gICAgc2hhMjU2c3VtID0gY3J5cHRvLmNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShidWYpLmRpZ2VzdCgnaGV4JylcbiAgfVxuICBjb25zdCBtZDVzdW0gPSBjcnlwdG8uY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKGJ1ZikuZGlnZXN0KCdiYXNlNjQnKVxuXG4gIHJldHVybiB7IG1kNXN1bSwgc2hhMjU2c3VtIH1cbn1cblxuLy8gUzMgcGVyY2VudC1lbmNvZGVzIHNvbWUgZXh0cmEgbm9uLXN0YW5kYXJkIGNoYXJhY3RlcnMgaW4gYSBVUkkgLiBTbyBjb21wbHkgd2l0aCBTMy5cbmNvbnN0IGVuY29kZUFzSGV4ID0gKGM6IHN0cmluZykgPT4gYCUke2MuY2hhckNvZGVBdCgwKS50b1N0cmluZygxNikudG9VcHBlckNhc2UoKX1gXG5leHBvcnQgZnVuY3Rpb24gdXJpRXNjYXBlKHVyaVN0cjogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGVuY29kZVVSSUNvbXBvbmVudCh1cmlTdHIpLnJlcGxhY2UoL1shJygpKl0vZywgZW5jb2RlQXNIZXgpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB1cmlSZXNvdXJjZUVzY2FwZShzdHJpbmc6IHN0cmluZykge1xuICByZXR1cm4gdXJpRXNjYXBlKHN0cmluZykucmVwbGFjZSgvJTJGL2csICcvJylcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFNjb3BlKHJlZ2lvbjogc3RyaW5nLCBkYXRlOiBEYXRlLCBzZXJ2aWNlTmFtZSA9ICdzMycpIHtcbiAgcmV0dXJuIGAke21ha2VEYXRlU2hvcnQoZGF0ZSl9LyR7cmVnaW9ufS8ke3NlcnZpY2VOYW1lfS9hd3M0X3JlcXVlc3RgXG59XG5cbi8qKlxuICogaXNBbWF6b25FbmRwb2ludCAtIHRydWUgaWYgZW5kcG9pbnQgaXMgJ3MzLmFtYXpvbmF3cy5jb20nIG9yICdzMy5jbi1ub3J0aC0xLmFtYXpvbmF3cy5jb20uY24nXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0FtYXpvbkVuZHBvaW50KGVuZHBvaW50OiBzdHJpbmcpIHtcbiAgcmV0dXJuIGVuZHBvaW50ID09PSAnczMuYW1hem9uYXdzLmNvbScgfHwgZW5kcG9pbnQgPT09ICdzMy5jbi1ub3J0aC0xLmFtYXpvbmF3cy5jb20uY24nXG59XG5cbi8qKlxuICogaXNWaXJ0dWFsSG9zdFN0eWxlIC0gdmVyaWZ5IGlmIGJ1Y2tldCBuYW1lIGlzIHN1cHBvcnQgd2l0aCB2aXJ0dWFsXG4gKiBob3N0cy4gYnVja2V0TmFtZXMgd2l0aCBwZXJpb2RzIHNob3VsZCBiZSBhbHdheXMgdHJlYXRlZCBhcyBwYXRoXG4gKiBzdHlsZSBpZiB0aGUgcHJvdG9jb2wgaXMgJ2h0dHBzOicsIHRoaXMgaXMgZHVlIHRvIFNTTCB3aWxkY2FyZFxuICogbGltaXRhdGlvbi4gRm9yIGFsbCBvdGhlciBidWNrZXRzIGFuZCBBbWF6b24gUzMgZW5kcG9pbnQgd2Ugd2lsbFxuICogZGVmYXVsdCB0byB2aXJ0dWFsIGhvc3Qgc3R5bGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1ZpcnR1YWxIb3N0U3R5bGUoZW5kcG9pbnQ6IHN0cmluZywgcHJvdG9jb2w6IHN0cmluZywgYnVja2V0OiBzdHJpbmcsIHBhdGhTdHlsZTogYm9vbGVhbikge1xuICBpZiAocHJvdG9jb2wgPT09ICdodHRwczonICYmIGJ1Y2tldC5pbmNsdWRlcygnLicpKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgcmV0dXJuIGlzQW1hem9uRW5kcG9pbnQoZW5kcG9pbnQpIHx8ICFwYXRoU3R5bGVcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWRJUChpcDogc3RyaW5nKSB7XG4gIHJldHVybiBpcGFkZHIuaXNWYWxpZChpcClcbn1cblxuLyoqXG4gKiBAcmV0dXJucyBpZiBlbmRwb2ludCBpcyB2YWxpZCBkb21haW4uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkRW5kcG9pbnQoZW5kcG9pbnQ6IHN0cmluZykge1xuICByZXR1cm4gaXNWYWxpZERvbWFpbihlbmRwb2ludCkgfHwgaXNWYWxpZElQKGVuZHBvaW50KVxufVxuXG4vKipcbiAqIEByZXR1cm5zIGlmIGlucHV0IGhvc3QgaXMgYSB2YWxpZCBkb21haW4uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkRG9tYWluKGhvc3Q6IHN0cmluZykge1xuICBpZiAoIWlzU3RyaW5nKGhvc3QpKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgLy8gU2VlIFJGQyAxMDM1LCBSRkMgMzY5Ni5cbiAgaWYgKGhvc3QubGVuZ3RoID09PSAwIHx8IGhvc3QubGVuZ3RoID4gMjU1KSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgLy8gSG9zdCBjYW5ub3Qgc3RhcnQgb3IgZW5kIHdpdGggYSAnLSdcbiAgaWYgKGhvc3RbMF0gPT09ICctJyB8fCBob3N0LnNsaWNlKC0xKSA9PT0gJy0nKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgLy8gSG9zdCBjYW5ub3Qgc3RhcnQgb3IgZW5kIHdpdGggYSAnXydcbiAgaWYgKGhvc3RbMF0gPT09ICdfJyB8fCBob3N0LnNsaWNlKC0xKSA9PT0gJ18nKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgLy8gSG9zdCBjYW5ub3Qgc3RhcnQgd2l0aCBhICcuJ1xuICBpZiAoaG9zdFswXSA9PT0gJy4nKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICBjb25zdCBub25BbHBoYU51bWVyaWNzID0gJ2B+IUAjJCVeJiooKSs9e31bXXxcXFxcXCJcXCc7Oj48Py8nXG4gIC8vIEFsbCBub24gYWxwaGFudW1lcmljIGNoYXJhY3RlcnMgYXJlIGludmFsaWQuXG4gIGZvciAoY29uc3QgY2hhciBvZiBub25BbHBoYU51bWVyaWNzKSB7XG4gICAgaWYgKGhvc3QuaW5jbHVkZXMoY2hhcikpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgfVxuICAvLyBObyBuZWVkIHRvIHJlZ2V4cCBtYXRjaCwgc2luY2UgdGhlIGxpc3QgaXMgbm9uLWV4aGF1c3RpdmUuXG4gIC8vIFdlIGxldCBpdCBiZSB2YWxpZCBhbmQgZmFpbCBsYXRlci5cbiAgcmV0dXJuIHRydWVcbn1cblxuLyoqXG4gKiBQcm9iZXMgY29udGVudFR5cGUgdXNpbmcgZmlsZSBleHRlbnNpb25zLlxuICpcbiAqIEBleGFtcGxlXG4gKiBgYGBcbiAqIC8vIHJldHVybiAnaW1hZ2UvcG5nJ1xuICogcHJvYmVDb250ZW50VHlwZSgnZmlsZS5wbmcnKVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcm9iZUNvbnRlbnRUeXBlKHBhdGg6IHN0cmluZykge1xuICBsZXQgY29udGVudFR5cGUgPSBtaW1lLmxvb2t1cChwYXRoKVxuICBpZiAoIWNvbnRlbnRUeXBlKSB7XG4gICAgY29udGVudFR5cGUgPSAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJ1xuICB9XG4gIHJldHVybiBjb250ZW50VHlwZVxufVxuXG4vKipcbiAqIGlzIGlucHV0IHBvcnQgdmFsaWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkUG9ydChwb3J0OiB1bmtub3duKTogcG9ydCBpcyBudW1iZXIge1xuICAvLyBDb252ZXJ0IHN0cmluZyBwb3J0IHRvIG51bWJlciBpZiBuZWVkZWRcbiAgY29uc3QgcG9ydE51bSA9IHR5cGVvZiBwb3J0ID09PSAnc3RyaW5nJyA/IHBhcnNlSW50KHBvcnQsIDEwKSA6IHBvcnRcblxuICAvLyB2ZXJpZnkgaWYgcG9ydCBpcyBhIHZhbGlkIG51bWJlclxuICBpZiAoIWlzTnVtYmVyKHBvcnROdW0pIHx8IGlzTmFOKHBvcnROdW0pKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvLyBwb3J0IGAwYCBpcyB2YWxpZCBhbmQgc3BlY2lhbCBjYXNlXG4gIHJldHVybiAwIDw9IHBvcnROdW0gJiYgcG9ydE51bSA8PSA2NTUzNVxufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0OiB1bmtub3duKSB7XG4gIGlmICghaXNTdHJpbmcoYnVja2V0KSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLy8gYnVja2V0IGxlbmd0aCBzaG91bGQgYmUgbGVzcyB0aGFuIGFuZCBubyBtb3JlIHRoYW4gNjNcbiAgLy8gY2hhcmFjdGVycyBsb25nLlxuICBpZiAoYnVja2V0Lmxlbmd0aCA8IDMgfHwgYnVja2V0Lmxlbmd0aCA+IDYzKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgLy8gYnVja2V0IHdpdGggc3VjY2Vzc2l2ZSBwZXJpb2RzIGlzIGludmFsaWQuXG4gIGlmIChidWNrZXQuaW5jbHVkZXMoJy4uJykpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuICAvLyBidWNrZXQgY2Fubm90IGhhdmUgaXAgYWRkcmVzcyBzdHlsZS5cbiAgaWYgKC9bMC05XStcXC5bMC05XStcXC5bMC05XStcXC5bMC05XSsvLnRlc3QoYnVja2V0KSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIGJ1Y2tldCBzaG91bGQgYmVnaW4gd2l0aCBhbHBoYWJldC9udW1iZXIgYW5kIGVuZCB3aXRoIGFscGhhYmV0L251bWJlcixcbiAgLy8gd2l0aCBhbHBoYWJldC9udW1iZXIvLi0gaW4gdGhlIG1pZGRsZS5cbiAgaWYgKC9eW2EtejAtOV1bYS16MC05Li1dK1thLXowLTldJC8udGVzdChidWNrZXQpKSB7XG4gICAgcmV0dXJuIHRydWVcbiAgfVxuICByZXR1cm4gZmFsc2Vcbn1cblxuLyoqXG4gKiBjaGVjayBpZiBvYmplY3ROYW1lIGlzIGEgdmFsaWQgb2JqZWN0IG5hbWVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWU6IHVua25vd24pIHtcbiAgaWYgKCFpc1ZhbGlkUHJlZml4KG9iamVjdE5hbWUpKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICByZXR1cm4gb2JqZWN0TmFtZS5sZW5ndGggIT09IDBcbn1cblxuLyoqXG4gKiBjaGVjayBpZiBwcmVmaXggaXMgdmFsaWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWRQcmVmaXgocHJlZml4OiB1bmtub3duKTogcHJlZml4IGlzIHN0cmluZyB7XG4gIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIGlmIChwcmVmaXgubGVuZ3RoID4gMTAyNCkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIHJldHVybiB0cnVlXG59XG5cbi8qKlxuICogY2hlY2sgaWYgdHlwZW9mIGFyZyBudW1iZXJcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzTnVtYmVyKGFyZzogdW5rbm93bik6IGFyZyBpcyBudW1iZXIge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ251bWJlcidcbn1cblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbmV4cG9ydCB0eXBlIEFueUZ1bmN0aW9uID0gKC4uLmFyZ3M6IGFueVtdKSA9PiBhbnlcblxuLyoqXG4gKiBjaGVjayBpZiB0eXBlb2YgYXJnIGZ1bmN0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0Z1bmN0aW9uKGFyZzogdW5rbm93bik6IGFyZyBpcyBBbnlGdW5jdGlvbiB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnZnVuY3Rpb24nXG59XG5cbi8qKlxuICogY2hlY2sgaWYgdHlwZW9mIGFyZyBzdHJpbmdcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3RyaW5nKGFyZzogdW5rbm93bik6IGFyZyBpcyBzdHJpbmcge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ3N0cmluZydcbn1cblxuLyoqXG4gKiBjaGVjayBpZiB0eXBlb2YgYXJnIG9iamVjdFxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNPYmplY3QoYXJnOiB1bmtub3duKTogYXJnIGlzIG9iamVjdCB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnb2JqZWN0JyAmJiBhcmcgIT09IG51bGxcbn1cblxuLyoqXG4gKiBjaGVjayBpZiBvYmplY3QgaXMgcmVhZGFibGUgc3RyZWFtXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1JlYWRhYmxlU3RyZWFtKGFyZzogdW5rbm93bik6IGFyZyBpcyBzdHJlYW0uUmVhZGFibGUge1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L3VuYm91bmQtbWV0aG9kXG4gIHJldHVybiBpc09iamVjdChhcmcpICYmIGlzRnVuY3Rpb24oKGFyZyBhcyBzdHJlYW0uUmVhZGFibGUpLl9yZWFkKVxufVxuXG4vKipcbiAqIGNoZWNrIGlmIGFyZyBpcyBib29sZWFuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0Jvb2xlYW4oYXJnOiB1bmtub3duKTogYXJnIGlzIGJvb2xlYW4ge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ2Jvb2xlYW4nXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0VtcHR5KG86IHVua25vd24pOiBvIGlzIG51bGwgfCB1bmRlZmluZWQge1xuICByZXR1cm4gXy5pc0VtcHR5KG8pXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0VtcHR5T2JqZWN0KG86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogYm9vbGVhbiB7XG4gIHJldHVybiBPYmplY3QudmFsdWVzKG8pLmZpbHRlcigoeCkgPT4geCAhPT0gdW5kZWZpbmVkKS5sZW5ndGggIT09IDBcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzRGVmaW5lZDxUPihvOiBUKTogbyBpcyBFeGNsdWRlPFQsIG51bGwgfCB1bmRlZmluZWQ+IHtcbiAgcmV0dXJuIG8gIT09IG51bGwgJiYgbyAhPT0gdW5kZWZpbmVkXG59XG5cbi8qKlxuICogY2hlY2sgaWYgYXJnIGlzIGEgdmFsaWQgZGF0ZVxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZERhdGUoYXJnOiB1bmtub3duKTogYXJnIGlzIERhdGUge1xuICAvLyBAdHMtZXhwZWN0LWVycm9yIGNoZWNrbmV3IERhdGUoTWF0aC5OYU4pXG4gIHJldHVybiBhcmcgaW5zdGFuY2VvZiBEYXRlICYmICFpc05hTihhcmcpXG59XG5cbi8qKlxuICogQ3JlYXRlIGEgRGF0ZSBzdHJpbmcgd2l0aCBmb3JtYXQ6ICdZWVlZTU1ERFRISG1tc3MnICsgWlxuICovXG5leHBvcnQgZnVuY3Rpb24gbWFrZURhdGVMb25nKGRhdGU/OiBEYXRlKTogc3RyaW5nIHtcbiAgZGF0ZSA9IGRhdGUgfHwgbmV3IERhdGUoKVxuXG4gIC8vIEdpdmVzIGZvcm1hdCBsaWtlOiAnMjAxNy0wOC0wN1QxNjoyODo1OS44ODlaJ1xuICBjb25zdCBzID0gZGF0ZS50b0lTT1N0cmluZygpXG5cbiAgcmV0dXJuIHMuc2xpY2UoMCwgNCkgKyBzLnNsaWNlKDUsIDcpICsgcy5zbGljZSg4LCAxMykgKyBzLnNsaWNlKDE0LCAxNikgKyBzLnNsaWNlKDE3LCAxOSkgKyAnWidcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBEYXRlIHN0cmluZyB3aXRoIGZvcm1hdDogJ1lZWVlNTUREJ1xuICovXG5leHBvcnQgZnVuY3Rpb24gbWFrZURhdGVTaG9ydChkYXRlPzogRGF0ZSkge1xuICBkYXRlID0gZGF0ZSB8fCBuZXcgRGF0ZSgpXG5cbiAgLy8gR2l2ZXMgZm9ybWF0IGxpa2U6ICcyMDE3LTA4LTA3VDE2OjI4OjU5Ljg4OVonXG4gIGNvbnN0IHMgPSBkYXRlLnRvSVNPU3RyaW5nKClcblxuICByZXR1cm4gcy5zbGljZSgwLCA0KSArIHMuc2xpY2UoNSwgNykgKyBzLnNsaWNlKDgsIDEwKVxufVxuXG4vKipcbiAqIHBpcGVzZXR1cCBzZXRzIHVwIHBpcGUoKSBmcm9tIGxlZnQgdG8gcmlnaHQgb3Mgc3RyZWFtcyBhcnJheVxuICogcGlwZXNldHVwIHdpbGwgYWxzbyBtYWtlIHN1cmUgdGhhdCBlcnJvciBlbWl0dGVkIGF0IGFueSBvZiB0aGUgdXBzdHJlYW0gU3RyZWFtXG4gKiB3aWxsIGJlIGVtaXR0ZWQgYXQgdGhlIGxhc3Qgc3RyZWFtLiBUaGlzIG1ha2VzIGVycm9yIGhhbmRsaW5nIHNpbXBsZVxuICovXG5leHBvcnQgZnVuY3Rpb24gcGlwZXNldHVwKC4uLnN0cmVhbXM6IFtzdHJlYW0uUmVhZGFibGUsIC4uLnN0cmVhbS5EdXBsZXhbXSwgc3RyZWFtLldyaXRhYmxlXSkge1xuICAvLyBAdHMtZXhwZWN0LWVycm9yIHRzIGNhbid0IG5hcnJvdyB0aGlzXG4gIHJldHVybiBzdHJlYW1zLnJlZHVjZSgoc3JjOiBzdHJlYW0uUmVhZGFibGUsIGRzdDogc3RyZWFtLldyaXRhYmxlKSA9PiB7XG4gICAgc3JjLm9uKCdlcnJvcicsIChlcnIpID0+IGRzdC5lbWl0KCdlcnJvcicsIGVycikpXG4gICAgcmV0dXJuIHNyYy5waXBlKGRzdClcbiAgfSlcbn1cblxuLyoqXG4gKiByZXR1cm4gYSBSZWFkYWJsZSBzdHJlYW0gdGhhdCBlbWl0cyBkYXRhXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWFkYWJsZVN0cmVhbShkYXRhOiB1bmtub3duKTogc3RyZWFtLlJlYWRhYmxlIHtcbiAgY29uc3QgcyA9IG5ldyBzdHJlYW0uUmVhZGFibGUoKVxuICBzLl9yZWFkID0gKCkgPT4ge31cbiAgcy5wdXNoKGRhdGEpXG4gIHMucHVzaChudWxsKVxuICByZXR1cm4gc1xufVxuXG4vKipcbiAqIFByb2Nlc3MgbWV0YWRhdGEgdG8gaW5zZXJ0IGFwcHJvcHJpYXRlIHZhbHVlIHRvIGBjb250ZW50LXR5cGVgIGF0dHJpYnV0ZVxuICovXG5leHBvcnQgZnVuY3Rpb24gaW5zZXJ0Q29udGVudFR5cGUobWV0YURhdGE6IE9iamVjdE1ldGFEYXRhLCBmaWxlUGF0aDogc3RyaW5nKTogT2JqZWN0TWV0YURhdGEge1xuICAvLyBjaGVjayBpZiBjb250ZW50LXR5cGUgYXR0cmlidXRlIHByZXNlbnQgaW4gbWV0YURhdGFcbiAgZm9yIChjb25zdCBrZXkgaW4gbWV0YURhdGEpIHtcbiAgICBpZiAoa2V5LnRvTG93ZXJDYXNlKCkgPT09ICdjb250ZW50LXR5cGUnKSB7XG4gICAgICByZXR1cm4gbWV0YURhdGFcbiAgICB9XG4gIH1cblxuICAvLyBpZiBgY29udGVudC10eXBlYCBhdHRyaWJ1dGUgaXMgbm90IHByZXNlbnQgaW4gbWV0YWRhdGEsIHRoZW4gaW5mZXIgaXQgZnJvbSB0aGUgZXh0ZW5zaW9uIGluIGZpbGVQYXRoXG4gIHJldHVybiB7XG4gICAgLi4ubWV0YURhdGEsXG4gICAgJ2NvbnRlbnQtdHlwZSc6IHByb2JlQ29udGVudFR5cGUoZmlsZVBhdGgpLFxuICB9XG59XG5cbi8qKlxuICogRnVuY3Rpb24gcHJlcGVuZHMgbWV0YWRhdGEgd2l0aCB0aGUgYXBwcm9wcmlhdGUgcHJlZml4IGlmIGl0IGlzIG5vdCBhbHJlYWR5IG9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcmVwZW5kWEFNWk1ldGEobWV0YURhdGE/OiBPYmplY3RNZXRhRGF0YSk6IFJlcXVlc3RIZWFkZXJzIHtcbiAgaWYgKCFtZXRhRGF0YSkge1xuICAgIHJldHVybiB7fVxuICB9XG5cbiAgcmV0dXJuIF8ubWFwS2V5cyhtZXRhRGF0YSwgKHZhbHVlLCBrZXkpID0+IHtcbiAgICBpZiAoaXNBbXpIZWFkZXIoa2V5KSB8fCBpc1N1cHBvcnRlZEhlYWRlcihrZXkpIHx8IGlzU3RvcmFnZUNsYXNzSGVhZGVyKGtleSkpIHtcbiAgICAgIHJldHVybiBrZXlcbiAgICB9XG5cbiAgICByZXR1cm4gTWV0YURhdGFIZWFkZXJQcmVmaXggKyBrZXlcbiAgfSlcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgaXQgaXMgYSB2YWxpZCBoZWFkZXIgYWNjb3JkaW5nIHRvIHRoZSBBbWF6b25TMyBBUElcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzQW16SGVhZGVyKGtleTogc3RyaW5nKSB7XG4gIGNvbnN0IHRlbXAgPSBrZXkudG9Mb3dlckNhc2UoKVxuICByZXR1cm4gKFxuICAgIHRlbXAuc3RhcnRzV2l0aChNZXRhRGF0YUhlYWRlclByZWZpeCkgfHxcbiAgICB0ZW1wID09PSAneC1hbXotYWNsJyB8fFxuICAgIHRlbXAuc3RhcnRzV2l0aCgneC1hbXotc2VydmVyLXNpZGUtZW5jcnlwdGlvbi0nKSB8fFxuICAgIHRlbXAgPT09ICd4LWFtei1zZXJ2ZXItc2lkZS1lbmNyeXB0aW9uJ1xuICApXG59XG5cbi8qKlxuICogQ2hlY2tzIGlmIGl0IGlzIGEgc3VwcG9ydGVkIEhlYWRlclxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNTdXBwb3J0ZWRIZWFkZXIoa2V5OiBzdHJpbmcpIHtcbiAgY29uc3Qgc3VwcG9ydGVkX2hlYWRlcnMgPSBbXG4gICAgJ2NvbnRlbnQtdHlwZScsXG4gICAgJ2NhY2hlLWNvbnRyb2wnLFxuICAgICdjb250ZW50LWVuY29kaW5nJyxcbiAgICAnY29udGVudC1kaXNwb3NpdGlvbicsXG4gICAgJ2NvbnRlbnQtbGFuZ3VhZ2UnLFxuICAgICd4LWFtei13ZWJzaXRlLXJlZGlyZWN0LWxvY2F0aW9uJyxcbiAgICAnaWYtbm9uZS1tYXRjaCcsXG4gICAgJ2lmLW1hdGNoJyxcbiAgXVxuICByZXR1cm4gc3VwcG9ydGVkX2hlYWRlcnMuaW5jbHVkZXMoa2V5LnRvTG93ZXJDYXNlKCkpXG59XG5cbi8qKlxuICogQ2hlY2tzIGlmIGl0IGlzIGEgc3RvcmFnZSBoZWFkZXJcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3RvcmFnZUNsYXNzSGVhZGVyKGtleTogc3RyaW5nKSB7XG4gIHJldHVybiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gJ3gtYW16LXN0b3JhZ2UtY2xhc3MnXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0TWV0YWRhdGEoaGVhZGVyczogUmVzcG9uc2VIZWFkZXIpIHtcbiAgcmV0dXJuIF8ubWFwS2V5cyhcbiAgICBfLnBpY2tCeShoZWFkZXJzLCAodmFsdWUsIGtleSkgPT4gaXNTdXBwb3J0ZWRIZWFkZXIoa2V5KSB8fCBpc1N0b3JhZ2VDbGFzc0hlYWRlcihrZXkpIHx8IGlzQW16SGVhZGVyKGtleSkpLFxuICAgICh2YWx1ZSwga2V5KSA9PiB7XG4gICAgICBjb25zdCBsb3dlciA9IGtleS50b0xvd2VyQ2FzZSgpXG4gICAgICBpZiAobG93ZXIuc3RhcnRzV2l0aChNZXRhRGF0YUhlYWRlclByZWZpeCkpIHtcbiAgICAgICAgcmV0dXJuIGxvd2VyLnNsaWNlKE1ldGFEYXRhSGVhZGVyUHJlZml4Lmxlbmd0aClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGtleVxuICAgIH0sXG4gIClcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFZlcnNpb25JZChoZWFkZXJzOiBSZXNwb25zZUhlYWRlciA9IHt9KSB7XG4gIHJldHVybiBoZWFkZXJzWyd4LWFtei12ZXJzaW9uLWlkJ10gfHwgbnVsbFxufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0U291cmNlVmVyc2lvbklkKGhlYWRlcnM6IFJlc3BvbnNlSGVhZGVyID0ge30pIHtcbiAgcmV0dXJuIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLXZlcnNpb24taWQnXSB8fCBudWxsXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZUVUYWcoZXRhZyA9ICcnKTogc3RyaW5nIHtcbiAgY29uc3QgcmVwbGFjZUNoYXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICdcIic6ICcnLFxuICAgICcmcXVvdDsnOiAnJyxcbiAgICAnJiMzNDsnOiAnJyxcbiAgICAnJlFVT1Q7JzogJycsXG4gICAgJyYjeDAwMDIyJzogJycsXG4gIH1cbiAgcmV0dXJuIGV0YWcucmVwbGFjZSgvXihcInwmcXVvdDt8JiMzNDspfChcInwmcXVvdDt8JiMzNDspJC9nLCAobSkgPT4gcmVwbGFjZUNoYXJzW21dIGFzIHN0cmluZylcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvTWQ1KHBheWxvYWQ6IEJpbmFyeSk6IHN0cmluZyB7XG4gIC8vIHVzZSBzdHJpbmcgZnJvbSBicm93c2VyIGFuZCBidWZmZXIgZnJvbSBub2RlanNcbiAgLy8gYnJvd3NlciBzdXBwb3J0IGlzIHRlc3RlZCBvbmx5IGFnYWluc3QgbWluaW8gc2VydmVyXG4gIHJldHVybiBjcnlwdG8uY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKEJ1ZmZlci5mcm9tKHBheWxvYWQpKS5kaWdlc3QoKS50b1N0cmluZygnYmFzZTY0Jylcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvU2hhMjU2KHBheWxvYWQ6IEJpbmFyeSk6IHN0cmluZyB7XG4gIHJldHVybiBjcnlwdG8uY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKHBheWxvYWQpLmRpZ2VzdCgnaGV4Jylcbn1cblxuLyoqXG4gKiB0b0FycmF5IHJldHVybnMgYSBzaW5nbGUgZWxlbWVudCBhcnJheSB3aXRoIHBhcmFtIGJlaW5nIHRoZSBlbGVtZW50LFxuICogaWYgcGFyYW0gaXMganVzdCBhIHN0cmluZywgYW5kIHJldHVybnMgJ3BhcmFtJyBiYWNrIGlmIGl0IGlzIGFuIGFycmF5XG4gKiBTbywgaXQgbWFrZXMgc3VyZSBwYXJhbSBpcyBhbHdheXMgYW4gYXJyYXlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRvQXJyYXk8VCA9IHVua25vd24+KHBhcmFtOiBUIHwgVFtdKTogQXJyYXk8VD4ge1xuICBpZiAoIUFycmF5LmlzQXJyYXkocGFyYW0pKSB7XG4gICAgcmV0dXJuIFtwYXJhbV0gYXMgVFtdXG4gIH1cbiAgcmV0dXJuIHBhcmFtXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZU9iamVjdEtleShvYmplY3ROYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAvLyArIHN5bWJvbCBjaGFyYWN0ZXJzIGFyZSBub3QgZGVjb2RlZCBhcyBzcGFjZXMgaW4gSlMuIHNvIHJlcGxhY2UgdGhlbSBmaXJzdCBhbmQgZGVjb2RlIHRvIGdldCB0aGUgY29ycmVjdCByZXN1bHQuXG4gIGNvbnN0IGFzU3RyTmFtZSA9IChvYmplY3ROYW1lID8gb2JqZWN0TmFtZS50b1N0cmluZygpIDogJycpLnJlcGxhY2UoL1xcKy9nLCAnICcpXG4gIHJldHVybiBkZWNvZGVVUklDb21wb25lbnQoYXNTdHJOYW1lKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVTaXplKHNpemU/OiBzdHJpbmcpOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICByZXR1cm4gc2l6ZSA/IE51bWJlci5wYXJzZUludChzaXplKSA6IHVuZGVmaW5lZFxufVxuXG5leHBvcnQgY29uc3QgUEFSVF9DT05TVFJBSU5UUyA9IHtcbiAgLy8gYWJzTWluUGFydFNpemUgLSBhYnNvbHV0ZSBtaW5pbXVtIHBhcnQgc2l6ZSAoNSBNaUIpXG4gIEFCU19NSU5fUEFSVF9TSVpFOiAxMDI0ICogMTAyNCAqIDUsXG4gIC8vIE1JTl9QQVJUX1NJWkUgLSBtaW5pbXVtIHBhcnQgc2l6ZSAxNk1pQiBwZXIgb2JqZWN0IGFmdGVyIHdoaWNoXG4gIE1JTl9QQVJUX1NJWkU6IDEwMjQgKiAxMDI0ICogMTYsXG4gIC8vIE1BWF9QQVJUU19DT1VOVCAtIG1heGltdW0gbnVtYmVyIG9mIHBhcnRzIGZvciBhIHNpbmdsZSBtdWx0aXBhcnQgc2Vzc2lvbi5cbiAgTUFYX1BBUlRTX0NPVU5UOiAxMDAwMCxcbiAgLy8gTUFYX1BBUlRfU0laRSAtIG1heGltdW0gcGFydCBzaXplIDVHaUIgZm9yIGEgc2luZ2xlIG11bHRpcGFydCB1cGxvYWRcbiAgLy8gb3BlcmF0aW9uLlxuICBNQVhfUEFSVF9TSVpFOiAxMDI0ICogMTAyNCAqIDEwMjQgKiA1LFxuICAvLyBNQVhfU0lOR0xFX1BVVF9PQkpFQ1RfU0laRSAtIG1heGltdW0gc2l6ZSA1R2lCIG9mIG9iamVjdCBwZXIgUFVUXG4gIC8vIG9wZXJhdGlvbi5cbiAgTUFYX1NJTkdMRV9QVVRfT0JKRUNUX1NJWkU6IDEwMjQgKiAxMDI0ICogMTAyNCAqIDUsXG4gIC8vIE1BWF9NVUxUSVBBUlRfUFVUX09CSkVDVF9TSVpFIC0gbWF4aW11bSBzaXplIDVUaUIgb2Ygb2JqZWN0IGZvclxuICAvLyBNdWx0aXBhcnQgb3BlcmF0aW9uLlxuICBNQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRTogMTAyNCAqIDEwMjQgKiAxMDI0ICogMTAyNCAqIDUsXG59XG5cbmNvbnN0IEdFTkVSSUNfU1NFX0hFQURFUiA9ICdYLUFtei1TZXJ2ZXItU2lkZS1FbmNyeXB0aW9uJ1xuXG5jb25zdCBFTkNSWVBUSU9OX0hFQURFUlMgPSB7XG4gIC8vIHNzZUdlbmVyaWNIZWFkZXIgaXMgdGhlIEFXUyBTU0UgaGVhZGVyIHVzZWQgZm9yIFNTRS1TMyBhbmQgU1NFLUtNUy5cbiAgc3NlR2VuZXJpY0hlYWRlcjogR0VORVJJQ19TU0VfSEVBREVSLFxuICAvLyBzc2VLbXNLZXlJRCBpcyB0aGUgQVdTIFNTRS1LTVMga2V5IGlkLlxuICBzc2VLbXNLZXlJRDogR0VORVJJQ19TU0VfSEVBREVSICsgJy1Bd3MtS21zLUtleS1JZCcsXG59IGFzIGNvbnN0XG5cbi8qKlxuICogUmV0dXJuIEVuY3J5cHRpb24gaGVhZGVyc1xuICogQHBhcmFtIGVuY0NvbmZpZ1xuICogQHJldHVybnMgYW4gb2JqZWN0IHdpdGgga2V5IHZhbHVlIHBhaXJzIHRoYXQgY2FuIGJlIHVzZWQgaW4gaGVhZGVycy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldEVuY3J5cHRpb25IZWFkZXJzKGVuY0NvbmZpZzogRW5jcnlwdGlvbik6IFJlcXVlc3RIZWFkZXJzIHtcbiAgY29uc3QgZW5jVHlwZSA9IGVuY0NvbmZpZy50eXBlXG5cbiAgaWYgKCFpc0VtcHR5KGVuY1R5cGUpKSB7XG4gICAgaWYgKGVuY1R5cGUgPT09IEVOQ1JZUFRJT05fVFlQRVMuU1NFQykge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgW0VOQ1JZUFRJT05fSEVBREVSUy5zc2VHZW5lcmljSGVhZGVyXTogJ0FFUzI1NicsXG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChlbmNUeXBlID09PSBFTkNSWVBUSU9OX1RZUEVTLktNUykge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgW0VOQ1JZUFRJT05fSEVBREVSUy5zc2VHZW5lcmljSGVhZGVyXTogZW5jQ29uZmlnLlNTRUFsZ29yaXRobSxcbiAgICAgICAgW0VOQ1JZUFRJT05fSEVBREVSUy5zc2VLbXNLZXlJRF06IGVuY0NvbmZpZy5LTVNNYXN0ZXJLZXlJRCxcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4ge31cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnRzUmVxdWlyZWQoc2l6ZTogbnVtYmVyKTogbnVtYmVyIHtcbiAgY29uc3QgbWF4UGFydFNpemUgPSBQQVJUX0NPTlNUUkFJTlRTLk1BWF9NVUxUSVBBUlRfUFVUX09CSkVDVF9TSVpFIC8gKFBBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRTX0NPVU5UIC0gMSlcbiAgbGV0IHJlcXVpcmVkUGFydFNpemUgPSBzaXplIC8gbWF4UGFydFNpemVcbiAgaWYgKHNpemUgJSBtYXhQYXJ0U2l6ZSA+IDApIHtcbiAgICByZXF1aXJlZFBhcnRTaXplKytcbiAgfVxuICByZXF1aXJlZFBhcnRTaXplID0gTWF0aC50cnVuYyhyZXF1aXJlZFBhcnRTaXplKVxuICByZXR1cm4gcmVxdWlyZWRQYXJ0U2l6ZVxufVxuXG4vKipcbiAqIGNhbGN1bGF0ZUV2ZW5TcGxpdHMgLSBjb21wdXRlcyBzcGxpdHMgZm9yIGEgc291cmNlIGFuZCByZXR1cm5zXG4gKiBzdGFydCBhbmQgZW5kIGluZGV4IHNsaWNlcy4gU3BsaXRzIGhhcHBlbiBldmVubHkgdG8gYmUgc3VyZSB0aGF0IG5vXG4gKiBwYXJ0IGlzIGxlc3MgdGhhbiA1TWlCLCBhcyB0aGF0IGNvdWxkIGZhaWwgdGhlIG11bHRpcGFydCByZXF1ZXN0IGlmXG4gKiBpdCBpcyBub3QgdGhlIGxhc3QgcGFydC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNhbGN1bGF0ZUV2ZW5TcGxpdHM8VCBleHRlbmRzIHsgU3RhcnQ/OiBudW1iZXIgfT4oXG4gIHNpemU6IG51bWJlcixcbiAgb2JqSW5mbzogVCxcbik6IHtcbiAgc3RhcnRJbmRleDogbnVtYmVyW11cbiAgb2JqSW5mbzogVFxuICBlbmRJbmRleDogbnVtYmVyW11cbn0gfCBudWxsIHtcbiAgaWYgKHNpemUgPT09IDApIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG4gIGNvbnN0IHJlcVBhcnRzID0gcGFydHNSZXF1aXJlZChzaXplKVxuICBjb25zdCBzdGFydEluZGV4UGFydHM6IG51bWJlcltdID0gW11cbiAgY29uc3QgZW5kSW5kZXhQYXJ0czogbnVtYmVyW10gPSBbXVxuXG4gIGxldCBzdGFydCA9IG9iakluZm8uU3RhcnRcbiAgaWYgKGlzRW1wdHkoc3RhcnQpIHx8IHN0YXJ0ID09PSAtMSkge1xuICAgIHN0YXJ0ID0gMFxuICB9XG4gIGNvbnN0IGRpdmlzb3JWYWx1ZSA9IE1hdGgudHJ1bmMoc2l6ZSAvIHJlcVBhcnRzKVxuXG4gIGNvbnN0IHJlbWluZGVyVmFsdWUgPSBzaXplICUgcmVxUGFydHNcblxuICBsZXQgbmV4dFN0YXJ0ID0gc3RhcnRcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IHJlcVBhcnRzOyBpKyspIHtcbiAgICBsZXQgY3VyUGFydFNpemUgPSBkaXZpc29yVmFsdWVcbiAgICBpZiAoaSA8IHJlbWluZGVyVmFsdWUpIHtcbiAgICAgIGN1clBhcnRTaXplKytcbiAgICB9XG5cbiAgICBjb25zdCBjdXJyZW50U3RhcnQgPSBuZXh0U3RhcnRcbiAgICBjb25zdCBjdXJyZW50RW5kID0gY3VycmVudFN0YXJ0ICsgY3VyUGFydFNpemUgLSAxXG4gICAgbmV4dFN0YXJ0ID0gY3VycmVudEVuZCArIDFcblxuICAgIHN0YXJ0SW5kZXhQYXJ0cy5wdXNoKGN1cnJlbnRTdGFydClcbiAgICBlbmRJbmRleFBhcnRzLnB1c2goY3VycmVudEVuZClcbiAgfVxuXG4gIHJldHVybiB7IHN0YXJ0SW5kZXg6IHN0YXJ0SW5kZXhQYXJ0cywgZW5kSW5kZXg6IGVuZEluZGV4UGFydHMsIG9iakluZm86IG9iakluZm8gfVxufVxuY29uc3QgZnhwID0gbmV3IFhNTFBhcnNlcih7IG51bWJlclBhcnNlT3B0aW9uczogeyBlTm90YXRpb246IGZhbHNlLCBoZXg6IHRydWUsIGxlYWRpbmdaZXJvczogdHJ1ZSB9IH0pXG5cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tZXhwbGljaXQtYW55XG5leHBvcnQgZnVuY3Rpb24gcGFyc2VYbWwoeG1sOiBzdHJpbmcpOiBhbnkge1xuICBjb25zdCByZXN1bHQgPSBmeHAucGFyc2UoeG1sKVxuICBpZiAocmVzdWx0LkVycm9yKSB7XG4gICAgdGhyb3cgcmVzdWx0LkVycm9yXG4gIH1cblxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8qKlxuICogZ2V0IGNvbnRlbnQgc2l6ZSBvZiBvYmplY3QgY29udGVudCB0byB1cGxvYWRcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldENvbnRlbnRMZW5ndGgoczogc3RyZWFtLlJlYWRhYmxlIHwgQnVmZmVyIHwgc3RyaW5nKTogUHJvbWlzZTxudW1iZXIgfCBudWxsPiB7XG4gIC8vIHVzZSBsZW5ndGggcHJvcGVydHkgb2Ygc3RyaW5nIHwgQnVmZmVyXG4gIGlmICh0eXBlb2YgcyA9PT0gJ3N0cmluZycgfHwgQnVmZmVyLmlzQnVmZmVyKHMpKSB7XG4gICAgcmV0dXJuIHMubGVuZ3RoXG4gIH1cblxuICAvLyBwcm9wZXJ0eSBvZiBgZnMuUmVhZFN0cmVhbWBcbiAgY29uc3QgZmlsZVBhdGggPSAocyBhcyB1bmtub3duIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KS5wYXRoIGFzIHN0cmluZyB8IHVuZGVmaW5lZFxuICBpZiAoZmlsZVBhdGggJiYgdHlwZW9mIGZpbGVQYXRoID09PSAnc3RyaW5nJykge1xuICAgIGNvbnN0IHN0YXQgPSBhd2FpdCBmc3AubHN0YXQoZmlsZVBhdGgpXG4gICAgcmV0dXJuIHN0YXQuc2l6ZVxuICB9XG5cbiAgLy8gcHJvcGVydHkgb2YgYGZzLlJlYWRTdHJlYW1gXG4gIGNvbnN0IGZkID0gKHMgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuZmQgYXMgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZFxuICBpZiAoZmQgJiYgdHlwZW9mIGZkID09PSAnbnVtYmVyJykge1xuICAgIGNvbnN0IHN0YXQgPSBhd2FpdCBmc3RhdChmZClcbiAgICByZXR1cm4gc3RhdC5zaXplXG4gIH1cblxuICByZXR1cm4gbnVsbFxufVxuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBZ0JBLElBQUFBLE1BQUEsR0FBQUMsdUJBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFDLE1BQUEsR0FBQUYsdUJBQUEsQ0FBQUMsT0FBQTtBQUVBLElBQUFFLGNBQUEsR0FBQUYsT0FBQTtBQUNBLElBQUFHLE9BQUEsR0FBQUgsT0FBQTtBQUNBLElBQUFJLE9BQUEsR0FBQUosT0FBQTtBQUNBLElBQUFLLElBQUEsR0FBQU4sdUJBQUEsQ0FBQUMsT0FBQTtBQUVBLElBQUFNLE1BQUEsR0FBQU4sT0FBQTtBQUVBLElBQUFPLEtBQUEsR0FBQVAsT0FBQTtBQUE0QyxTQUFBUSx5QkFBQUMsV0FBQSxlQUFBQyxPQUFBLGtDQUFBQyxpQkFBQSxPQUFBRCxPQUFBLFFBQUFFLGdCQUFBLE9BQUFGLE9BQUEsWUFBQUYsd0JBQUEsWUFBQUEsQ0FBQUMsV0FBQSxXQUFBQSxXQUFBLEdBQUFHLGdCQUFBLEdBQUFELGlCQUFBLEtBQUFGLFdBQUE7QUFBQSxTQUFBVix3QkFBQWMsR0FBQSxFQUFBSixXQUFBLFNBQUFB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