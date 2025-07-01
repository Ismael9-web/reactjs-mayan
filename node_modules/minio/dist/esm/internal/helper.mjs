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

import * as crypto from "crypto";
import * as stream from "stream";
import { XMLParser } from 'fast-xml-parser';
import ipaddr from 'ipaddr.js';
import _ from 'lodash';
import * as mime from 'mime-types';
import { fsp, fstat } from "./async.mjs";
import { ENCRYPTION_TYPES } from "./type.mjs";
const MetaDataHeaderPrefix = 'x-amz-meta-';
export function hashBinary(buf, enableSHA256) {
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
export function uriEscape(uriStr) {
  return encodeURIComponent(uriStr).replace(/[!'()*]/g, encodeAsHex);
}
export function uriResourceEscape(string) {
  return uriEscape(string).replace(/%2F/g, '/');
}
export function getScope(region, date, serviceName = 's3') {
  return `${makeDateShort(date)}/${region}/${serviceName}/aws4_request`;
}

/**
 * isAmazonEndpoint - true if endpoint is 's3.amazonaws.com' or 's3.cn-north-1.amazonaws.com.cn'
 */
export function isAmazonEndpoint(endpoint) {
  return endpoint === 's3.amazonaws.com' || endpoint === 's3.cn-north-1.amazonaws.com.cn';
}

/**
 * isVirtualHostStyle - verify if bucket name is support with virtual
 * hosts. bucketNames with periods should be always treated as path
 * style if the protocol is 'https:', this is due to SSL wildcard
 * limitation. For all other buckets and Amazon S3 endpoint we will
 * default to virtual host style.
 */
export function isVirtualHostStyle(endpoint, protocol, bucket, pathStyle) {
  if (protocol === 'https:' && bucket.includes('.')) {
    return false;
  }
  return isAmazonEndpoint(endpoint) || !pathStyle;
}
export function isValidIP(ip) {
  return ipaddr.isValid(ip);
}

/**
 * @returns if endpoint is valid domain.
 */
export function isValidEndpoint(endpoint) {
  return isValidDomain(endpoint) || isValidIP(endpoint);
}

/**
 * @returns if input host is a valid domain.
 */
export function isValidDomain(host) {
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
export function probeContentType(path) {
  let contentType = mime.lookup(path);
  if (!contentType) {
    contentType = 'application/octet-stream';
  }
  return contentType;
}

/**
 * is input port valid.
 */
export function isValidPort(port) {
  // Convert string port to number if needed
  const portNum = typeof port === 'string' ? parseInt(port, 10) : port;

  // verify if port is a valid number
  if (!isNumber(portNum) || isNaN(portNum)) {
    return false;
  }

  // port `0` is valid and special case
  return 0 <= portNum && portNum <= 65535;
}
export function isValidBucketName(bucket) {
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
export function isValidObjectName(objectName) {
  if (!isValidPrefix(objectName)) {
    return false;
  }
  return objectName.length !== 0;
}

/**
 * check if prefix is valid
 */
export function isValidPrefix(prefix) {
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
export function isNumber(arg) {
  return typeof arg === 'number';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any

/**
 * check if typeof arg function
 */
export function isFunction(arg) {
  return typeof arg === 'function';
}

/**
 * check if typeof arg string
 */
export function isString(arg) {
  return typeof arg === 'string';
}

/**
 * check if typeof arg object
 */
export function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

/**
 * check if object is readable stream
 */
export function isReadableStream(arg) {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  return isObject(arg) && isFunction(arg._read);
}

/**
 * check if arg is boolean
 */
export function isBoolean(arg) {
  return typeof arg === 'boolean';
}
export function isEmpty(o) {
  return _.isEmpty(o);
}
export function isEmptyObject(o) {
  return Object.values(o).filter(x => x !== undefined).length !== 0;
}
export function isDefined(o) {
  return o !== null && o !== undefined;
}

/**
 * check if arg is a valid date
 */
export function isValidDate(arg) {
  // @ts-expect-error checknew Date(Math.NaN)
  return arg instanceof Date && !isNaN(arg);
}

/**
 * Create a Date string with format: 'YYYYMMDDTHHmmss' + Z
 */
export function makeDateLong(date) {
  date = date || new Date();

  // Gives format like: '2017-08-07T16:28:59.889Z'
  const s = date.toISOString();
  return s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 13) + s.slice(14, 16) + s.slice(17, 19) + 'Z';
}

/**
 * Create a Date string with format: 'YYYYMMDD'
 */
export function makeDateShort(date) {
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
export function pipesetup(...streams) {
  // @ts-expect-error ts can't narrow this
  return streams.reduce((src, dst) => {
    src.on('error', err => dst.emit('error', err));
    return src.pipe(dst);
  });
}

/**
 * return a Readable stream that emits data
 */
export function readableStream(data) {
  const s = new stream.Readable();
  s._read = () => {};
  s.push(data);
  s.push(null);
  return s;
}

/**
 * Process metadata to insert appropriate value to `content-type` attribute
 */
export function insertContentType(metaData, filePath) {
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
export function prependXAMZMeta(metaData) {
  if (!metaData) {
    return {};
  }
  return _.mapKeys(metaData, (value, key) => {
    if (isAmzHeader(key) || isSupportedHeader(key) || isStorageClassHeader(key)) {
      return key;
    }
    return MetaDataHeaderPrefix + key;
  });
}

/**
 * Checks if it is a valid header according to the AmazonS3 API
 */
export function isAmzHeader(key) {
  const temp = key.toLowerCase();
  return temp.startsWith(MetaDataHeaderPrefix) || temp === 'x-amz-acl' || temp.startsWith('x-amz-server-side-encryption-') || temp === 'x-amz-server-side-encryption';
}

/**
 * Checks if it is a supported Header
 */
export function isSupportedHeader(key) {
  const supported_headers = ['content-type', 'cache-control', 'content-encoding', 'content-disposition', 'content-language', 'x-amz-website-redirect-location', 'if-none-match', 'if-match'];
  return supported_headers.includes(key.toLowerCase());
}

/**
 * Checks if it is a storage header
 */
export function isStorageClassHeader(key) {
  return key.toLowerCase() === 'x-amz-storage-class';
}
export function extractMetadata(headers) {
  return _.mapKeys(_.pickBy(headers, (value, key) => isSupportedHeader(key) || isStorageClassHeader(key) || isAmzHeader(key)), (value, key) => {
    const lower = key.toLowerCase();
    if (lower.startsWith(MetaDataHeaderPrefix)) {
      return lower.slice(MetaDataHeaderPrefix.length);
    }
    return key;
  });
}
export function getVersionId(headers = {}) {
  return headers['x-amz-version-id'] || null;
}
export function getSourceVersionId(headers = {}) {
  return headers['x-amz-copy-source-version-id'] || null;
}
export function sanitizeETag(etag = '') {
  const replaceChars = {
    '"': '',
    '&quot;': '',
    '&#34;': '',
    '&QUOT;': '',
    '&#x00022': ''
  };
  return etag.replace(/^("|&quot;|&#34;)|("|&quot;|&#34;)$/g, m => replaceChars[m]);
}
export function toMd5(payload) {
  // use string from browser and buffer from nodejs
  // browser support is tested only against minio server
  return crypto.createHash('md5').update(Buffer.from(payload)).digest().toString('base64');
}
export function toSha256(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * toArray returns a single element array with param being the element,
 * if param is just a string, and returns 'param' back if it is an array
 * So, it makes sure param is always an array
 */
export function toArray(param) {
  if (!Array.isArray(param)) {
    return [param];
  }
  return param;
}
export function sanitizeObjectKey(objectName) {
  // + symbol characters are not decoded as spaces in JS. so replace them first and decode to get the correct result.
  const asStrName = (objectName ? objectName.toString() : '').replace(/\+/g, ' ');
  return decodeURIComponent(asStrName);
}
export function sanitizeSize(size) {
  return size ? Number.parseInt(size) : undefined;
}
export const PART_CONSTRAINTS = {
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
export function getEncryptionHeaders(encConfig) {
  const encType = encConfig.type;
  if (!isEmpty(encType)) {
    if (encType === ENCRYPTION_TYPES.SSEC) {
      return {
        [ENCRYPTION_HEADERS.sseGenericHeader]: 'AES256'
      };
    } else if (encType === ENCRYPTION_TYPES.KMS) {
      return {
        [ENCRYPTION_HEADERS.sseGenericHeader]: encConfig.SSEAlgorithm,
        [ENCRYPTION_HEADERS.sseKmsKeyID]: encConfig.KMSMasterKeyID
      };
    }
  }
  return {};
}
export function partsRequired(size) {
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
export function calculateEvenSplits(size, objInfo) {
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
const fxp = new XMLParser({
  numberParseOptions: {
    eNotation: false,
    hex: true,
    leadingZeros: true
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseXml(xml) {
  const result = fxp.parse(xml);
  if (result.Error) {
    throw result.Error;
  }
  return result;
}

/**
 * get content size of object content to upload
 */
export async function getContentLength(s) {
  // use length property of string | Buffer
  if (typeof s === 'string' || Buffer.isBuffer(s)) {
    return s.length;
  }

  // property of `fs.ReadStream`
  const filePath = s.path;
  if (filePath && typeof filePath === 'string') {
    const stat = await fsp.lstat(filePath);
    return stat.size;
  }

  // property of `fs.ReadStream`
  const fd = s.fd;
  if (fd && typeof fd === 'number') {
    const stat = await fstat(fd);
    return stat.size;
  }
  return null;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcnlwdG8iLCJzdHJlYW0iLCJYTUxQYXJzZXIiLCJpcGFkZHIiLCJfIiwibWltZSIsImZzcCIsImZzdGF0IiwiRU5DUllQVElPTl9UWVBFUyIsIk1ldGFEYXRhSGVhZGVyUHJlZml4IiwiaGFzaEJpbmFyeSIsImJ1ZiIsImVuYWJsZVNIQTI1NiIsInNoYTI1NnN1bSIsImNyZWF0ZUhhc2giLCJ1cGRhdGUiLCJkaWdlc3QiLCJtZDVzdW0iLCJlbmNvZGVBc0hleCIsImMiLCJjaGFyQ29kZUF0IiwidG9TdHJpbmciLCJ0b1VwcGVyQ2FzZSIsInVyaUVzY2FwZSIsInVyaVN0ciIsImVuY29kZVVSSUNvbXBvbmVudCIsInJlcGxhY2UiLCJ1cmlSZXNvdXJjZUVzY2FwZSIsInN0cmluZyIsImdldFNjb3BlIiwicmVnaW9uIiwiZGF0ZSIsInNlcnZpY2VOYW1lIiwibWFrZURhdGVTaG9ydCIsImlzQW1hem9uRW5kcG9pbnQiLCJlbmRwb2ludCIsImlzVmlydHVhbEhvc3RTdHlsZSIsInByb3RvY29sIiwiYnVja2V0IiwicGF0aFN0eWxlIiwiaW5jbHVkZXMiLCJpc1ZhbGlkSVAiLCJpcCIsImlzVmFsaWQiLCJpc1ZhbGlkRW5kcG9pbnQiLCJpc1ZhbGlkRG9tYWluIiwiaG9zdCIsImlzU3RyaW5nIiwibGVuZ3RoIiwic2xpY2UiLCJub25BbHBoYU51bWVyaWNzIiwiY2hhciIsInByb2JlQ29udGVudFR5cGUiLCJwYXRoIiwiY29udGVudFR5cGUiLCJsb29rdXAiLCJpc1ZhbGlkUG9ydCIsInBvcnQiLCJwb3J0TnVtIiwicGFyc2VJbnQiLCJpc051bWJlciIsImlzTmFOIiwiaXNWYWxpZEJ1Y2tldE5hbWUiLCJ0ZXN0IiwiaXNWYWxpZE9iamVjdE5hbWUiLCJvYmplY3ROYW1lIiwiaXNWYWxpZFByZWZpeCIsInByZWZpeCIsImFyZyIsImlzRnVuY3Rpb24iLCJpc09iamVjdCIsImlzUmVhZGFibGVTdHJlYW0iLCJfcmVhZCIsImlzQm9vbGVhbiIsImlzRW1wdHkiLCJvIiwiaXNFbXB0eU9iamVjdCIsIk9iamVjdCIsInZhbHVlcyIsImZpbHRlciIsIngiLCJ1bmRlZmluZWQiLCJpc0RlZmluZWQiLCJpc1ZhbGlkRGF0ZSIsIkRhdGUiLCJtYWtlRGF0ZUxvbmciLCJzIiwidG9JU09TdHJpbmciLCJwaXBlc2V0dXAiLCJzdHJlYW1zIiwicmVkdWNlIiwic3JjIiwiZHN0Iiwib24iLCJlcnIiLCJlbWl0IiwicGlwZSIsInJlYWRhYmxlU3RyZWFtIiwiZGF0YSIsIlJlYWRhYmxlIiwicHVzaCIsImluc2VydENvbnRlbnRUeXBlIiwibWV0YURhdGEiLCJmaWxlUGF0aCIsImtleSIsInRvTG93ZXJDYXNlIiwicHJlcGVuZFhBTVpNZXRhIiwibWFwS2V5cyIsInZhbHVlIiwiaXNBbXpIZWFkZXIiLCJpc1N1cHBvcnRlZEhlYWRlciIsImlzU3RvcmFnZUNsYXNzSGVhZGVyIiwidGVtcCIsInN0YXJ0c1dpdGgiLCJzdXBwb3J0ZWRfaGVhZGVycyIsImV4dHJhY3RNZXRhZGF0YSIsImhlYWRlcnMiLCJwaWNrQnkiLCJsb3dlciIsImdldFZlcnNpb25JZCIsImdldFNvdXJjZVZlcnNpb25JZCIsInNhbml0aXplRVRhZyIsImV0YWciLCJyZXBsYWNlQ2hhcnMiLCJtIiwidG9NZDUiLCJwYXlsb2FkIiwiQnVmZmVyIiwiZnJvbSIsInRvU2hhMjU2IiwidG9BcnJheSIsInBhcmFtIiwiQXJyYXkiLCJpc0FycmF5Iiwic2FuaXRpemVPYmplY3RLZXkiLCJhc1N0ck5hbWUiLCJkZWNvZGVVUklDb21wb25lbnQiLCJzYW5pdGl6ZVNpemUiLCJzaXplIiwiTnVtYmVyIiwiUEFSVF9DT05TVFJBSU5UUyIsIkFCU19NSU5fUEFSVF9TSVpFIiwiTUlOX1BBUlRfU0laRSIsIk1BWF9QQVJUU19DT1VOVCIsIk1BWF9QQVJUX1NJWkUiLCJNQVhfU0lOR0xFX1BVVF9PQkpFQ1RfU0laRSIsIk1BWF9NVUxUSVBBUlRfUFVUX09CSkVDVF9TSVpFIiwiR0VORVJJQ19TU0VfSEVBREVSIiwiRU5DUllQVElPTl9IRUFERVJTIiwic3NlR2VuZXJpY0hlYWRlciIsInNzZUttc0tleUlEIiwiZ2V0RW5jcnlwdGlvbkhlYWRlcnMiLCJlbmNDb25maWciLCJlbmNUeXBlIiwidHlwZSIsIlNTRUMiLCJLTVMiLCJTU0VBbGdvcml0aG0iLCJLTVNNYXN0ZXJLZXlJRCIsInBhcnRzUmVxdWlyZWQiLCJtYXhQYXJ0U2l6ZSIsInJlcXVpcmVkUGFydFNpemUiLCJNYXRoIiwidHJ1bmMiLCJjYWxjdWxhdGVFdmVuU3BsaXRzIiwib2JqSW5mbyIsInJlcVBhcnRzIiwic3RhcnRJbmRleFBhcnRzIiwiZW5kSW5kZXhQYXJ0cyIsInN0YXJ0IiwiU3RhcnQiLCJkaXZpc29yVmFsdWUiLCJyZW1pbmRlclZhbHVlIiwibmV4dFN0YXJ0IiwiaSIsImN1clBhcnRTaXplIiwiY3VycmVudFN0YXJ0IiwiY3VycmVudEVuZCIsInN0YXJ0SW5kZXgiLCJlbmRJbmRleCIsImZ4cCIsIm51bWJlclBhcnNlT3B0aW9ucyIsImVOb3RhdGlvbiIsImhleCIsImxlYWRpbmdaZXJvcyIsInBhcnNlWG1sIiwieG1sIiwicmVzdWx0IiwicGFyc2UiLCJFcnJvciIsImdldENvbnRlbnRMZW5ndGgiLCJpc0J1ZmZlciIsInN0YXQiLCJsc3RhdCIsImZkIl0sInNvdXJjZXMiOlsiaGVscGVyLnRzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qXG4gKiBNaW5JTyBKYXZhc2NyaXB0IExpYnJhcnkgZm9yIEFtYXpvbiBTMyBDb21wYXRpYmxlIENsb3VkIFN0b3JhZ2UsIChDKSAyMDE1IE1pbklPLCBJbmMuXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICovXG5cbmltcG9ydCAqIGFzIGNyeXB0byBmcm9tICdub2RlOmNyeXB0bydcbmltcG9ydCAqIGFzIHN0cmVhbSBmcm9tICdub2RlOnN0cmVhbSdcblxuaW1wb3J0IHsgWE1MUGFyc2VyIH0gZnJvbSAnZmFzdC14bWwtcGFyc2VyJ1xuaW1wb3J0IGlwYWRkciBmcm9tICdpcGFkZHIuanMnXG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnXG5pbXBvcnQgKiBhcyBtaW1lIGZyb20gJ21pbWUtdHlwZXMnXG5cbmltcG9ydCB7IGZzcCwgZnN0YXQgfSBmcm9tICcuL2FzeW5jLnRzJ1xuaW1wb3J0IHR5cGUgeyBCaW5hcnksIEVuY3J5cHRpb24sIE9iamVjdE1ldGFEYXRhLCBSZXF1ZXN0SGVhZGVycywgUmVzcG9uc2VIZWFkZXIgfSBmcm9tICcuL3R5cGUudHMnXG5pbXBvcnQgeyBFTkNSWVBUSU9OX1RZUEVTIH0gZnJvbSAnLi90eXBlLnRzJ1xuXG5jb25zdCBNZXRhRGF0YUhlYWRlclByZWZpeCA9ICd4LWFtei1tZXRhLSdcblxuZXhwb3J0IGZ1bmN0aW9uIGhhc2hCaW5hcnkoYnVmOiBCdWZmZXIsIGVuYWJsZVNIQTI1NjogYm9vbGVhbikge1xuICBsZXQgc2hhMjU2c3VtID0gJydcbiAgaWYgKGVuYWJsZVNIQTI1Nikge1xuICAgIHNoYTI1NnN1bSA9IGNyeXB0by5jcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUoYnVmKS5kaWdlc3QoJ2hleCcpXG4gIH1cbiAgY29uc3QgbWQ1c3VtID0gY3J5cHRvLmNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShidWYpLmRpZ2VzdCgnYmFzZTY0JylcblxuICByZXR1cm4geyBtZDVzdW0sIHNoYTI1NnN1bSB9XG59XG5cbi8vIFMzIHBlcmNlbnQtZW5jb2RlcyBzb21lIGV4dHJhIG5vbi1zdGFuZGFyZCBjaGFyYWN0ZXJzIGluIGEgVVJJIC4gU28gY29tcGx5IHdpdGggUzMuXG5jb25zdCBlbmNvZGVBc0hleCA9IChjOiBzdHJpbmcpID0+IGAlJHtjLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCl9YFxuZXhwb3J0IGZ1bmN0aW9uIHVyaUVzY2FwZSh1cmlTdHI6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBlbmNvZGVVUklDb21wb25lbnQodXJpU3RyKS5yZXBsYWNlKC9bIScoKSpdL2csIGVuY29kZUFzSGV4KVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdXJpUmVzb3VyY2VFc2NhcGUoc3RyaW5nOiBzdHJpbmcpIHtcbiAgcmV0dXJuIHVyaUVzY2FwZShzdHJpbmcpLnJlcGxhY2UoLyUyRi9nLCAnLycpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRTY29wZShyZWdpb246IHN0cmluZywgZGF0ZTogRGF0ZSwgc2VydmljZU5hbWUgPSAnczMnKSB7XG4gIHJldHVybiBgJHttYWtlRGF0ZVNob3J0KGRhdGUpfS8ke3JlZ2lvbn0vJHtzZXJ2aWNlTmFtZX0vYXdzNF9yZXF1ZXN0YFxufVxuXG4vKipcbiAqIGlzQW1hem9uRW5kcG9pbnQgLSB0cnVlIGlmIGVuZHBvaW50IGlzICdzMy5hbWF6b25hd3MuY29tJyBvciAnczMuY24tbm9ydGgtMS5hbWF6b25hd3MuY29tLmNuJ1xuICovXG5leHBvcnQgZnVuY3Rpb24gaXNBbWF6b25FbmRwb2ludChlbmRwb2ludDogc3RyaW5nKSB7XG4gIHJldHVybiBlbmRwb2ludCA9PT0gJ3MzLmFtYXpvbmF3cy5jb20nIHx8IGVuZHBvaW50ID09PSAnczMuY24tbm9ydGgtMS5hbWF6b25hd3MuY29tLmNuJ1xufVxuXG4vKipcbiAqIGlzVmlydHVhbEhvc3RTdHlsZSAtIHZlcmlmeSBpZiBidWNrZXQgbmFtZSBpcyBzdXBwb3J0IHdpdGggdmlydHVhbFxuICogaG9zdHMuIGJ1Y2tldE5hbWVzIHdpdGggcGVyaW9kcyBzaG91bGQgYmUgYWx3YXlzIHRyZWF0ZWQgYXMgcGF0aFxuICogc3R5bGUgaWYgdGhlIHByb3RvY29sIGlzICdodHRwczonLCB0aGlzIGlzIGR1ZSB0byBTU0wgd2lsZGNhcmRcbiAqIGxpbWl0YXRpb24uIEZvciBhbGwgb3RoZXIgYnVja2V0cyBhbmQgQW1hem9uIFMzIGVuZHBvaW50IHdlIHdpbGxcbiAqIGRlZmF1bHQgdG8gdmlydHVhbCBob3N0IHN0eWxlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWaXJ0dWFsSG9zdFN0eWxlKGVuZHBvaW50OiBzdHJpbmcsIHByb3RvY29sOiBzdHJpbmcsIGJ1Y2tldDogc3RyaW5nLCBwYXRoU3R5bGU6IGJvb2xlYW4pIHtcbiAgaWYgKHByb3RvY29sID09PSAnaHR0cHM6JyAmJiBidWNrZXQuaW5jbHVkZXMoJy4nKSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIHJldHVybiBpc0FtYXpvbkVuZHBvaW50KGVuZHBvaW50KSB8fCAhcGF0aFN0eWxlXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkSVAoaXA6IHN0cmluZykge1xuICByZXR1cm4gaXBhZGRyLmlzVmFsaWQoaXApXG59XG5cbi8qKlxuICogQHJldHVybnMgaWYgZW5kcG9pbnQgaXMgdmFsaWQgZG9tYWluLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZEVuZHBvaW50KGVuZHBvaW50OiBzdHJpbmcpIHtcbiAgcmV0dXJuIGlzVmFsaWREb21haW4oZW5kcG9pbnQpIHx8IGlzVmFsaWRJUChlbmRwb2ludClcbn1cblxuLyoqXG4gKiBAcmV0dXJucyBpZiBpbnB1dCBob3N0IGlzIGEgdmFsaWQgZG9tYWluLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZERvbWFpbihob3N0OiBzdHJpbmcpIHtcbiAgaWYgKCFpc1N0cmluZyhob3N0KSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIFNlZSBSRkMgMTAzNSwgUkZDIDM2OTYuXG4gIGlmIChob3N0Lmxlbmd0aCA9PT0gMCB8fCBob3N0Lmxlbmd0aCA+IDI1NSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIEhvc3QgY2Fubm90IHN0YXJ0IG9yIGVuZCB3aXRoIGEgJy0nXG4gIGlmIChob3N0WzBdID09PSAnLScgfHwgaG9zdC5zbGljZSgtMSkgPT09ICctJykge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIEhvc3QgY2Fubm90IHN0YXJ0IG9yIGVuZCB3aXRoIGEgJ18nXG4gIGlmIChob3N0WzBdID09PSAnXycgfHwgaG9zdC5zbGljZSgtMSkgPT09ICdfJykge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIEhvc3QgY2Fubm90IHN0YXJ0IHdpdGggYSAnLidcbiAgaWYgKGhvc3RbMF0gPT09ICcuJykge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgY29uc3Qgbm9uQWxwaGFOdW1lcmljcyA9ICdgfiFAIyQlXiYqKCkrPXt9W118XFxcXFwiXFwnOzo+PD8vJ1xuICAvLyBBbGwgbm9uIGFscGhhbnVtZXJpYyBjaGFyYWN0ZXJzIGFyZSBpbnZhbGlkLlxuICBmb3IgKGNvbnN0IGNoYXIgb2Ygbm9uQWxwaGFOdW1lcmljcykge1xuICAgIGlmIChob3N0LmluY2x1ZGVzKGNoYXIpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gIH1cbiAgLy8gTm8gbmVlZCB0byByZWdleHAgbWF0Y2gsIHNpbmNlIHRoZSBsaXN0IGlzIG5vbi1leGhhdXN0aXZlLlxuICAvLyBXZSBsZXQgaXQgYmUgdmFsaWQgYW5kIGZhaWwgbGF0ZXIuXG4gIHJldHVybiB0cnVlXG59XG5cbi8qKlxuICogUHJvYmVzIGNvbnRlbnRUeXBlIHVzaW5nIGZpbGUgZXh0ZW5zaW9ucy5cbiAqXG4gKiBAZXhhbXBsZVxuICogYGBgXG4gKiAvLyByZXR1cm4gJ2ltYWdlL3BuZydcbiAqIHByb2JlQ29udGVudFR5cGUoJ2ZpbGUucG5nJylcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJvYmVDb250ZW50VHlwZShwYXRoOiBzdHJpbmcpIHtcbiAgbGV0IGNvbnRlbnRUeXBlID0gbWltZS5sb29rdXAocGF0aClcbiAgaWYgKCFjb250ZW50VHlwZSkge1xuICAgIGNvbnRlbnRUeXBlID0gJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbSdcbiAgfVxuICByZXR1cm4gY29udGVudFR5cGVcbn1cblxuLyoqXG4gKiBpcyBpbnB1dCBwb3J0IHZhbGlkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZFBvcnQocG9ydDogdW5rbm93bik6IHBvcnQgaXMgbnVtYmVyIHtcbiAgLy8gQ29udmVydCBzdHJpbmcgcG9ydCB0byBudW1iZXIgaWYgbmVlZGVkXG4gIGNvbnN0IHBvcnROdW0gPSB0eXBlb2YgcG9ydCA9PT0gJ3N0cmluZycgPyBwYXJzZUludChwb3J0LCAxMCkgOiBwb3J0XG5cbiAgLy8gdmVyaWZ5IGlmIHBvcnQgaXMgYSB2YWxpZCBudW1iZXJcbiAgaWYgKCFpc051bWJlcihwb3J0TnVtKSB8fCBpc05hTihwb3J0TnVtKSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLy8gcG9ydCBgMGAgaXMgdmFsaWQgYW5kIHNwZWNpYWwgY2FzZVxuICByZXR1cm4gMCA8PSBwb3J0TnVtICYmIHBvcnROdW0gPD0gNjU1MzVcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldDogdW5rbm93bikge1xuICBpZiAoIWlzU3RyaW5nKGJ1Y2tldCkpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8vIGJ1Y2tldCBsZW5ndGggc2hvdWxkIGJlIGxlc3MgdGhhbiBhbmQgbm8gbW9yZSB0aGFuIDYzXG4gIC8vIGNoYXJhY3RlcnMgbG9uZy5cbiAgaWYgKGJ1Y2tldC5sZW5ndGggPCAzIHx8IGJ1Y2tldC5sZW5ndGggPiA2Mykge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIGJ1Y2tldCB3aXRoIHN1Y2Nlc3NpdmUgcGVyaW9kcyBpcyBpbnZhbGlkLlxuICBpZiAoYnVja2V0LmluY2x1ZGVzKCcuLicpKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgLy8gYnVja2V0IGNhbm5vdCBoYXZlIGlwIGFkZHJlc3Mgc3R5bGUuXG4gIGlmICgvWzAtOV0rXFwuWzAtOV0rXFwuWzAtOV0rXFwuWzAtOV0rLy50ZXN0KGJ1Y2tldCkpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuICAvLyBidWNrZXQgc2hvdWxkIGJlZ2luIHdpdGggYWxwaGFiZXQvbnVtYmVyIGFuZCBlbmQgd2l0aCBhbHBoYWJldC9udW1iZXIsXG4gIC8vIHdpdGggYWxwaGFiZXQvbnVtYmVyLy4tIGluIHRoZSBtaWRkbGUuXG4gIGlmICgvXlthLXowLTldW2EtejAtOS4tXStbYS16MC05XSQvLnRlc3QoYnVja2V0KSkge1xuICAgIHJldHVybiB0cnVlXG4gIH1cbiAgcmV0dXJuIGZhbHNlXG59XG5cbi8qKlxuICogY2hlY2sgaWYgb2JqZWN0TmFtZSBpcyBhIHZhbGlkIG9iamVjdCBuYW1lXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lOiB1bmtub3duKSB7XG4gIGlmICghaXNWYWxpZFByZWZpeChvYmplY3ROYW1lKSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgcmV0dXJuIG9iamVjdE5hbWUubGVuZ3RoICE9PSAwXG59XG5cbi8qKlxuICogY2hlY2sgaWYgcHJlZml4IGlzIHZhbGlkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkUHJlZml4KHByZWZpeDogdW5rbm93bik6IHByZWZpeCBpcyBzdHJpbmcge1xuICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuICBpZiAocHJlZml4Lmxlbmd0aCA+IDEwMjQpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuICByZXR1cm4gdHJ1ZVxufVxuXG4vKipcbiAqIGNoZWNrIGlmIHR5cGVvZiBhcmcgbnVtYmVyXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc051bWJlcihhcmc6IHVua25vd24pOiBhcmcgaXMgbnVtYmVyIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdudW1iZXInXG59XG5cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tZXhwbGljaXQtYW55XG5leHBvcnQgdHlwZSBBbnlGdW5jdGlvbiA9ICguLi5hcmdzOiBhbnlbXSkgPT4gYW55XG5cbi8qKlxuICogY2hlY2sgaWYgdHlwZW9mIGFyZyBmdW5jdGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNGdW5jdGlvbihhcmc6IHVua25vd24pOiBhcmcgaXMgQW55RnVuY3Rpb24ge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ2Z1bmN0aW9uJ1xufVxuXG4vKipcbiAqIGNoZWNrIGlmIHR5cGVvZiBhcmcgc3RyaW5nXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1N0cmluZyhhcmc6IHVua25vd24pOiBhcmcgaXMgc3RyaW5nIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdzdHJpbmcnXG59XG5cbi8qKlxuICogY2hlY2sgaWYgdHlwZW9mIGFyZyBvYmplY3RcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzT2JqZWN0KGFyZzogdW5rbm93bik6IGFyZyBpcyBvYmplY3Qge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ29iamVjdCcgJiYgYXJnICE9PSBudWxsXG59XG5cbi8qKlxuICogY2hlY2sgaWYgb2JqZWN0IGlzIHJlYWRhYmxlIHN0cmVhbVxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNSZWFkYWJsZVN0cmVhbShhcmc6IHVua25vd24pOiBhcmcgaXMgc3RyZWFtLlJlYWRhYmxlIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC91bmJvdW5kLW1ldGhvZFxuICByZXR1cm4gaXNPYmplY3QoYXJnKSAmJiBpc0Z1bmN0aW9uKChhcmcgYXMgc3RyZWFtLlJlYWRhYmxlKS5fcmVhZClcbn1cblxuLyoqXG4gKiBjaGVjayBpZiBhcmcgaXMgYm9vbGVhblxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNCb29sZWFuKGFyZzogdW5rbm93bik6IGFyZyBpcyBib29sZWFuIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdib29sZWFuJ1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNFbXB0eShvOiB1bmtub3duKTogbyBpcyBudWxsIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIF8uaXNFbXB0eShvKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNFbXB0eU9iamVjdChvOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IGJvb2xlYW4ge1xuICByZXR1cm4gT2JqZWN0LnZhbHVlcyhvKS5maWx0ZXIoKHgpID0+IHggIT09IHVuZGVmaW5lZCkubGVuZ3RoICE9PSAwXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0RlZmluZWQ8VD4obzogVCk6IG8gaXMgRXhjbHVkZTxULCBudWxsIHwgdW5kZWZpbmVkPiB7XG4gIHJldHVybiBvICE9PSBudWxsICYmIG8gIT09IHVuZGVmaW5lZFxufVxuXG4vKipcbiAqIGNoZWNrIGlmIGFyZyBpcyBhIHZhbGlkIGRhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWREYXRlKGFyZzogdW5rbm93bik6IGFyZyBpcyBEYXRlIHtcbiAgLy8gQHRzLWV4cGVjdC1lcnJvciBjaGVja25ldyBEYXRlKE1hdGguTmFOKVxuICByZXR1cm4gYXJnIGluc3RhbmNlb2YgRGF0ZSAmJiAhaXNOYU4oYXJnKVxufVxuXG4vKipcbiAqIENyZWF0ZSBhIERhdGUgc3RyaW5nIHdpdGggZm9ybWF0OiAnWVlZWU1NRERUSEhtbXNzJyArIFpcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1ha2VEYXRlTG9uZyhkYXRlPzogRGF0ZSk6IHN0cmluZyB7XG4gIGRhdGUgPSBkYXRlIHx8IG5ldyBEYXRlKClcblxuICAvLyBHaXZlcyBmb3JtYXQgbGlrZTogJzIwMTctMDgtMDdUMTY6Mjg6NTkuODg5WidcbiAgY29uc3QgcyA9IGRhdGUudG9JU09TdHJpbmcoKVxuXG4gIHJldHVybiBzLnNsaWNlKDAsIDQpICsgcy5zbGljZSg1LCA3KSArIHMuc2xpY2UoOCwgMTMpICsgcy5zbGljZSgxNCwgMTYpICsgcy5zbGljZSgxNywgMTkpICsgJ1onXG59XG5cbi8qKlxuICogQ3JlYXRlIGEgRGF0ZSBzdHJpbmcgd2l0aCBmb3JtYXQ6ICdZWVlZTU1ERCdcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1ha2VEYXRlU2hvcnQoZGF0ZT86IERhdGUpIHtcbiAgZGF0ZSA9IGRhdGUgfHwgbmV3IERhdGUoKVxuXG4gIC8vIEdpdmVzIGZvcm1hdCBsaWtlOiAnMjAxNy0wOC0wN1QxNjoyODo1OS44ODlaJ1xuICBjb25zdCBzID0gZGF0ZS50b0lTT1N0cmluZygpXG5cbiAgcmV0dXJuIHMuc2xpY2UoMCwgNCkgKyBzLnNsaWNlKDUsIDcpICsgcy5zbGljZSg4LCAxMClcbn1cblxuLyoqXG4gKiBwaXBlc2V0dXAgc2V0cyB1cCBwaXBlKCkgZnJvbSBsZWZ0IHRvIHJpZ2h0IG9zIHN0cmVhbXMgYXJyYXlcbiAqIHBpcGVzZXR1cCB3aWxsIGFsc28gbWFrZSBzdXJlIHRoYXQgZXJyb3IgZW1pdHRlZCBhdCBhbnkgb2YgdGhlIHVwc3RyZWFtIFN0cmVhbVxuICogd2lsbCBiZSBlbWl0dGVkIGF0IHRoZSBsYXN0IHN0cmVhbS4gVGhpcyBtYWtlcyBlcnJvciBoYW5kbGluZyBzaW1wbGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBpcGVzZXR1cCguLi5zdHJlYW1zOiBbc3RyZWFtLlJlYWRhYmxlLCAuLi5zdHJlYW0uRHVwbGV4W10sIHN0cmVhbS5Xcml0YWJsZV0pIHtcbiAgLy8gQHRzLWV4cGVjdC1lcnJvciB0cyBjYW4ndCBuYXJyb3cgdGhpc1xuICByZXR1cm4gc3RyZWFtcy5yZWR1Y2UoKHNyYzogc3RyZWFtLlJlYWRhYmxlLCBkc3Q6IHN0cmVhbS5Xcml0YWJsZSkgPT4ge1xuICAgIHNyYy5vbignZXJyb3InLCAoZXJyKSA9PiBkc3QuZW1pdCgnZXJyb3InLCBlcnIpKVxuICAgIHJldHVybiBzcmMucGlwZShkc3QpXG4gIH0pXG59XG5cbi8qKlxuICogcmV0dXJuIGEgUmVhZGFibGUgc3RyZWFtIHRoYXQgZW1pdHMgZGF0YVxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVhZGFibGVTdHJlYW0oZGF0YTogdW5rbm93bik6IHN0cmVhbS5SZWFkYWJsZSB7XG4gIGNvbnN0IHMgPSBuZXcgc3RyZWFtLlJlYWRhYmxlKClcbiAgcy5fcmVhZCA9ICgpID0+IHt9XG4gIHMucHVzaChkYXRhKVxuICBzLnB1c2gobnVsbClcbiAgcmV0dXJuIHNcbn1cblxuLyoqXG4gKiBQcm9jZXNzIG1ldGFkYXRhIHRvIGluc2VydCBhcHByb3ByaWF0ZSB2YWx1ZSB0byBgY29udGVudC10eXBlYCBhdHRyaWJ1dGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGluc2VydENvbnRlbnRUeXBlKG1ldGFEYXRhOiBPYmplY3RNZXRhRGF0YSwgZmlsZVBhdGg6IHN0cmluZyk6IE9iamVjdE1ldGFEYXRhIHtcbiAgLy8gY2hlY2sgaWYgY29udGVudC10eXBlIGF0dHJpYnV0ZSBwcmVzZW50IGluIG1ldGFEYXRhXG4gIGZvciAoY29uc3Qga2V5IGluIG1ldGFEYXRhKSB7XG4gICAgaWYgKGtleS50b0xvd2VyQ2FzZSgpID09PSAnY29udGVudC10eXBlJykge1xuICAgICAgcmV0dXJuIG1ldGFEYXRhXG4gICAgfVxuICB9XG5cbiAgLy8gaWYgYGNvbnRlbnQtdHlwZWAgYXR0cmlidXRlIGlzIG5vdCBwcmVzZW50IGluIG1ldGFkYXRhLCB0aGVuIGluZmVyIGl0IGZyb20gdGhlIGV4dGVuc2lvbiBpbiBmaWxlUGF0aFxuICByZXR1cm4ge1xuICAgIC4uLm1ldGFEYXRhLFxuICAgICdjb250ZW50LXR5cGUnOiBwcm9iZUNvbnRlbnRUeXBlKGZpbGVQYXRoKSxcbiAgfVxufVxuXG4vKipcbiAqIEZ1bmN0aW9uIHByZXBlbmRzIG1ldGFkYXRhIHdpdGggdGhlIGFwcHJvcHJpYXRlIHByZWZpeCBpZiBpdCBpcyBub3QgYWxyZWFkeSBvblxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJlcGVuZFhBTVpNZXRhKG1ldGFEYXRhPzogT2JqZWN0TWV0YURhdGEpOiBSZXF1ZXN0SGVhZGVycyB7XG4gIGlmICghbWV0YURhdGEpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIHJldHVybiBfLm1hcEtleXMobWV0YURhdGEsICh2YWx1ZSwga2V5KSA9PiB7XG4gICAgaWYgKGlzQW16SGVhZGVyKGtleSkgfHwgaXNTdXBwb3J0ZWRIZWFkZXIoa2V5KSB8fCBpc1N0b3JhZ2VDbGFzc0hlYWRlcihrZXkpKSB7XG4gICAgICByZXR1cm4ga2V5XG4gICAgfVxuXG4gICAgcmV0dXJuIE1ldGFEYXRhSGVhZGVyUHJlZml4ICsga2V5XG4gIH0pXG59XG5cbi8qKlxuICogQ2hlY2tzIGlmIGl0IGlzIGEgdmFsaWQgaGVhZGVyIGFjY29yZGluZyB0byB0aGUgQW1hem9uUzMgQVBJXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0FtekhlYWRlcihrZXk6IHN0cmluZykge1xuICBjb25zdCB0ZW1wID0ga2V5LnRvTG93ZXJDYXNlKClcbiAgcmV0dXJuIChcbiAgICB0ZW1wLnN0YXJ0c1dpdGgoTWV0YURhdGFIZWFkZXJQcmVmaXgpIHx8XG4gICAgdGVtcCA9PT0gJ3gtYW16LWFjbCcgfHxcbiAgICB0ZW1wLnN0YXJ0c1dpdGgoJ3gtYW16LXNlcnZlci1zaWRlLWVuY3J5cHRpb24tJykgfHxcbiAgICB0ZW1wID09PSAneC1hbXotc2VydmVyLXNpZGUtZW5jcnlwdGlvbidcbiAgKVxufVxuXG4vKipcbiAqIENoZWNrcyBpZiBpdCBpcyBhIHN1cHBvcnRlZCBIZWFkZXJcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3VwcG9ydGVkSGVhZGVyKGtleTogc3RyaW5nKSB7XG4gIGNvbnN0IHN1cHBvcnRlZF9oZWFkZXJzID0gW1xuICAgICdjb250ZW50LXR5cGUnLFxuICAgICdjYWNoZS1jb250cm9sJyxcbiAgICAnY29udGVudC1lbmNvZGluZycsXG4gICAgJ2NvbnRlbnQtZGlzcG9zaXRpb24nLFxuICAgICdjb250ZW50LWxhbmd1YWdlJyxcbiAgICAneC1hbXotd2Vic2l0ZS1yZWRpcmVjdC1sb2NhdGlvbicsXG4gICAgJ2lmLW5vbmUtbWF0Y2gnLFxuICAgICdpZi1tYXRjaCcsXG4gIF1cbiAgcmV0dXJuIHN1cHBvcnRlZF9oZWFkZXJzLmluY2x1ZGVzKGtleS50b0xvd2VyQ2FzZSgpKVxufVxuXG4vKipcbiAqIENoZWNrcyBpZiBpdCBpcyBhIHN0b3JhZ2UgaGVhZGVyXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1N0b3JhZ2VDbGFzc0hlYWRlcihrZXk6IHN0cmluZykge1xuICByZXR1cm4ga2V5LnRvTG93ZXJDYXNlKCkgPT09ICd4LWFtei1zdG9yYWdlLWNsYXNzJ1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdE1ldGFkYXRhKGhlYWRlcnM6IFJlc3BvbnNlSGVhZGVyKSB7XG4gIHJldHVybiBfLm1hcEtleXMoXG4gICAgXy5waWNrQnkoaGVhZGVycywgKHZhbHVlLCBrZXkpID0+IGlzU3VwcG9ydGVkSGVhZGVyKGtleSkgfHwgaXNTdG9yYWdlQ2xhc3NIZWFkZXIoa2V5KSB8fCBpc0FtekhlYWRlcihrZXkpKSxcbiAgICAodmFsdWUsIGtleSkgPT4ge1xuICAgICAgY29uc3QgbG93ZXIgPSBrZXkudG9Mb3dlckNhc2UoKVxuICAgICAgaWYgKGxvd2VyLnN0YXJ0c1dpdGgoTWV0YURhdGFIZWFkZXJQcmVmaXgpKSB7XG4gICAgICAgIHJldHVybiBsb3dlci5zbGljZShNZXRhRGF0YUhlYWRlclByZWZpeC5sZW5ndGgpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBrZXlcbiAgICB9LFxuICApXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRWZXJzaW9uSWQoaGVhZGVyczogUmVzcG9uc2VIZWFkZXIgPSB7fSkge1xuICByZXR1cm4gaGVhZGVyc1sneC1hbXotdmVyc2lvbi1pZCddIHx8IG51bGxcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFNvdXJjZVZlcnNpb25JZChoZWFkZXJzOiBSZXNwb25zZUhlYWRlciA9IHt9KSB7XG4gIHJldHVybiBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS12ZXJzaW9uLWlkJ10gfHwgbnVsbFxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVFVGFnKGV0YWcgPSAnJyk6IHN0cmluZyB7XG4gIGNvbnN0IHJlcGxhY2VDaGFyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAnXCInOiAnJyxcbiAgICAnJnF1b3Q7JzogJycsXG4gICAgJyYjMzQ7JzogJycsXG4gICAgJyZRVU9UOyc6ICcnLFxuICAgICcmI3gwMDAyMic6ICcnLFxuICB9XG4gIHJldHVybiBldGFnLnJlcGxhY2UoL14oXCJ8JnF1b3Q7fCYjMzQ7KXwoXCJ8JnF1b3Q7fCYjMzQ7KSQvZywgKG0pID0+IHJlcGxhY2VDaGFyc1ttXSBhcyBzdHJpbmcpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0b01kNShwYXlsb2FkOiBCaW5hcnkpOiBzdHJpbmcge1xuICAvLyB1c2Ugc3RyaW5nIGZyb20gYnJvd3NlciBhbmQgYnVmZmVyIGZyb20gbm9kZWpzXG4gIC8vIGJyb3dzZXIgc3VwcG9ydCBpcyB0ZXN0ZWQgb25seSBhZ2FpbnN0IG1pbmlvIHNlcnZlclxuICByZXR1cm4gY3J5cHRvLmNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShCdWZmZXIuZnJvbShwYXlsb2FkKSkuZGlnZXN0KCkudG9TdHJpbmcoJ2Jhc2U2NCcpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0b1NoYTI1NihwYXlsb2FkOiBCaW5hcnkpOiBzdHJpbmcge1xuICByZXR1cm4gY3J5cHRvLmNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShwYXlsb2FkKS5kaWdlc3QoJ2hleCcpXG59XG5cbi8qKlxuICogdG9BcnJheSByZXR1cm5zIGEgc2luZ2xlIGVsZW1lbnQgYXJyYXkgd2l0aCBwYXJhbSBiZWluZyB0aGUgZWxlbWVudCxcbiAqIGlmIHBhcmFtIGlzIGp1c3QgYSBzdHJpbmcsIGFuZCByZXR1cm5zICdwYXJhbScgYmFjayBpZiBpdCBpcyBhbiBhcnJheVxuICogU28sIGl0IG1ha2VzIHN1cmUgcGFyYW0gaXMgYWx3YXlzIGFuIGFycmF5XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0b0FycmF5PFQgPSB1bmtub3duPihwYXJhbTogVCB8IFRbXSk6IEFycmF5PFQ+IHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHBhcmFtKSkge1xuICAgIHJldHVybiBbcGFyYW1dIGFzIFRbXVxuICB9XG4gIHJldHVybiBwYXJhbVxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVPYmplY3RLZXkob2JqZWN0TmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgLy8gKyBzeW1ib2wgY2hhcmFjdGVycyBhcmUgbm90IGRlY29kZWQgYXMgc3BhY2VzIGluIEpTLiBzbyByZXBsYWNlIHRoZW0gZmlyc3QgYW5kIGRlY29kZSB0byBnZXQgdGhlIGNvcnJlY3QgcmVzdWx0LlxuICBjb25zdCBhc1N0ck5hbWUgPSAob2JqZWN0TmFtZSA/IG9iamVjdE5hbWUudG9TdHJpbmcoKSA6ICcnKS5yZXBsYWNlKC9cXCsvZywgJyAnKVxuICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KGFzU3RyTmFtZSlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplU2l6ZShzaXplPzogc3RyaW5nKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIHNpemUgPyBOdW1iZXIucGFyc2VJbnQoc2l6ZSkgOiB1bmRlZmluZWRcbn1cblxuZXhwb3J0IGNvbnN0IFBBUlRfQ09OU1RSQUlOVFMgPSB7XG4gIC8vIGFic01pblBhcnRTaXplIC0gYWJzb2x1dGUgbWluaW11bSBwYXJ0IHNpemUgKDUgTWlCKVxuICBBQlNfTUlOX1BBUlRfU0laRTogMTAyNCAqIDEwMjQgKiA1LFxuICAvLyBNSU5fUEFSVF9TSVpFIC0gbWluaW11bSBwYXJ0IHNpemUgMTZNaUIgcGVyIG9iamVjdCBhZnRlciB3aGljaFxuICBNSU5fUEFSVF9TSVpFOiAxMDI0ICogMTAyNCAqIDE2LFxuICAvLyBNQVhfUEFSVFNfQ09VTlQgLSBtYXhpbXVtIG51bWJlciBvZiBwYXJ0cyBmb3IgYSBzaW5nbGUgbXVsdGlwYXJ0IHNlc3Npb24uXG4gIE1BWF9QQVJUU19DT1VOVDogMTAwMDAsXG4gIC8vIE1BWF9QQVJUX1NJWkUgLSBtYXhpbXVtIHBhcnQgc2l6ZSA1R2lCIGZvciBhIHNpbmdsZSBtdWx0aXBhcnQgdXBsb2FkXG4gIC8vIG9wZXJhdGlvbi5cbiAgTUFYX1BBUlRfU0laRTogMTAyNCAqIDEwMjQgKiAxMDI0ICogNSxcbiAgLy8gTUFYX1NJTkdMRV9QVVRfT0JKRUNUX1NJWkUgLSBtYXhpbXVtIHNpemUgNUdpQiBvZiBvYmplY3QgcGVyIFBVVFxuICAvLyBvcGVyYXRpb24uXG4gIE1BWF9TSU5HTEVfUFVUX09CSkVDVF9TSVpFOiAxMDI0ICogMTAyNCAqIDEwMjQgKiA1LFxuICAvLyBNQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSAtIG1heGltdW0gc2l6ZSA1VGlCIG9mIG9iamVjdCBmb3JcbiAgLy8gTXVsdGlwYXJ0IG9wZXJhdGlvbi5cbiAgTUFYX01VTFRJUEFSVF9QVVRfT0JKRUNUX1NJWkU6IDEwMjQgKiAxMDI0ICogMTAyNCAqIDEwMjQgKiA1LFxufVxuXG5jb25zdCBHRU5FUklDX1NTRV9IRUFERVIgPSAnWC1BbXotU2VydmVyLVNpZGUtRW5jcnlwdGlvbidcblxuY29uc3QgRU5DUllQVElPTl9IRUFERVJTID0ge1xuICAvLyBzc2VHZW5lcmljSGVhZGVyIGlzIHRoZSBBV1MgU1NFIGhlYWRlciB1c2VkIGZvciBTU0UtUzMgYW5kIFNTRS1LTVMuXG4gIHNzZUdlbmVyaWNIZWFkZXI6IEdFTkVSSUNfU1NFX0hFQURFUixcbiAgLy8gc3NlS21zS2V5SUQgaXMgdGhlIEFXUyBTU0UtS01TIGtleSBpZC5cbiAgc3NlS21zS2V5SUQ6IEdFTkVSSUNfU1NFX0hFQURFUiArICctQXdzLUttcy1LZXktSWQnLFxufSBhcyBjb25zdFxuXG4vKipcbiAqIFJldHVybiBFbmNyeXB0aW9uIGhlYWRlcnNcbiAqIEBwYXJhbSBlbmNDb25maWdcbiAqIEByZXR1cm5zIGFuIG9iamVjdCB3aXRoIGtleSB2YWx1ZSBwYWlycyB0aGF0IGNhbiBiZSB1c2VkIGluIGhlYWRlcnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRFbmNyeXB0aW9uSGVhZGVycyhlbmNDb25maWc6IEVuY3J5cHRpb24pOiBSZXF1ZXN0SGVhZGVycyB7XG4gIGNvbnN0IGVuY1R5cGUgPSBlbmNDb25maWcudHlwZVxuXG4gIGlmICghaXNFbXB0eShlbmNUeXBlKSkge1xuICAgIGlmIChlbmNUeXBlID09PSBFTkNSWVBUSU9OX1RZUEVTLlNTRUMpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIFtFTkNSWVBUSU9OX0hFQURFUlMuc3NlR2VuZXJpY0hlYWRlcl06ICdBRVMyNTYnLFxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoZW5jVHlwZSA9PT0gRU5DUllQVElPTl9UWVBFUy5LTVMpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIFtFTkNSWVBUSU9OX0hFQURFUlMuc3NlR2VuZXJpY0hlYWRlcl06IGVuY0NvbmZpZy5TU0VBbGdvcml0aG0sXG4gICAgICAgIFtFTkNSWVBUSU9OX0hFQURFUlMuc3NlS21zS2V5SURdOiBlbmNDb25maWcuS01TTWFzdGVyS2V5SUQsXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHt9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJ0c1JlcXVpcmVkKHNpemU6IG51bWJlcik6IG51bWJlciB7XG4gIGNvbnN0IG1heFBhcnRTaXplID0gUEFSVF9DT05TVFJBSU5UUy5NQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSAvIChQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVCAtIDEpXG4gIGxldCByZXF1aXJlZFBhcnRTaXplID0gc2l6ZSAvIG1heFBhcnRTaXplXG4gIGlmIChzaXplICUgbWF4UGFydFNpemUgPiAwKSB7XG4gICAgcmVxdWlyZWRQYXJ0U2l6ZSsrXG4gIH1cbiAgcmVxdWlyZWRQYXJ0U2l6ZSA9IE1hdGgudHJ1bmMocmVxdWlyZWRQYXJ0U2l6ZSlcbiAgcmV0dXJuIHJlcXVpcmVkUGFydFNpemVcbn1cblxuLyoqXG4gKiBjYWxjdWxhdGVFdmVuU3BsaXRzIC0gY29tcHV0ZXMgc3BsaXRzIGZvciBhIHNvdXJjZSBhbmQgcmV0dXJuc1xuICogc3RhcnQgYW5kIGVuZCBpbmRleCBzbGljZXMuIFNwbGl0cyBoYXBwZW4gZXZlbmx5IHRvIGJlIHN1cmUgdGhhdCBub1xuICogcGFydCBpcyBsZXNzIHRoYW4gNU1pQiwgYXMgdGhhdCBjb3VsZCBmYWlsIHRoZSBtdWx0aXBhcnQgcmVxdWVzdCBpZlxuICogaXQgaXMgbm90IHRoZSBsYXN0IHBhcnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjYWxjdWxhdGVFdmVuU3BsaXRzPFQgZXh0ZW5kcyB7IFN0YXJ0PzogbnVtYmVyIH0+KFxuICBzaXplOiBudW1iZXIsXG4gIG9iakluZm86IFQsXG4pOiB7XG4gIHN0YXJ0SW5kZXg6IG51bWJlcltdXG4gIG9iakluZm86IFRcbiAgZW5kSW5kZXg6IG51bWJlcltdXG59IHwgbnVsbCB7XG4gIGlmIChzaXplID09PSAwKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuICBjb25zdCByZXFQYXJ0cyA9IHBhcnRzUmVxdWlyZWQoc2l6ZSlcbiAgY29uc3Qgc3RhcnRJbmRleFBhcnRzOiBudW1iZXJbXSA9IFtdXG4gIGNvbnN0IGVuZEluZGV4UGFydHM6IG51bWJlcltdID0gW11cblxuICBsZXQgc3RhcnQgPSBvYmpJbmZvLlN0YXJ0XG4gIGlmIChpc0VtcHR5KHN0YXJ0KSB8fCBzdGFydCA9PT0gLTEpIHtcbiAgICBzdGFydCA9IDBcbiAgfVxuICBjb25zdCBkaXZpc29yVmFsdWUgPSBNYXRoLnRydW5jKHNpemUgLyByZXFQYXJ0cylcblxuICBjb25zdCByZW1pbmRlclZhbHVlID0gc2l6ZSAlIHJlcVBhcnRzXG5cbiAgbGV0IG5leHRTdGFydCA9IHN0YXJ0XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXFQYXJ0czsgaSsrKSB7XG4gICAgbGV0IGN1clBhcnRTaXplID0gZGl2aXNvclZhbHVlXG4gICAgaWYgKGkgPCByZW1pbmRlclZhbHVlKSB7XG4gICAgICBjdXJQYXJ0U2l6ZSsrXG4gICAgfVxuXG4gICAgY29uc3QgY3VycmVudFN0YXJ0ID0gbmV4dFN0YXJ0XG4gICAgY29uc3QgY3VycmVudEVuZCA9IGN1cnJlbnRTdGFydCArIGN1clBhcnRTaXplIC0gMVxuICAgIG5leHRTdGFydCA9IGN1cnJlbnRFbmQgKyAxXG5cbiAgICBzdGFydEluZGV4UGFydHMucHVzaChjdXJyZW50U3RhcnQpXG4gICAgZW5kSW5kZXhQYXJ0cy5wdXNoKGN1cnJlbnRFbmQpXG4gIH1cblxuICByZXR1cm4geyBzdGFydEluZGV4OiBzdGFydEluZGV4UGFydHMsIGVuZEluZGV4OiBlbmRJbmRleFBhcnRzLCBvYmpJbmZvOiBvYmpJbmZvIH1cbn1cbmNvbnN0IGZ4cCA9IG5ldyBYTUxQYXJzZXIoeyBudW1iZXJQYXJzZU9wdGlvbnM6IHsgZU5vdGF0aW9uOiBmYWxzZSwgaGV4OiB0cnVlLCBsZWFkaW5nWmVyb3M6IHRydWUgfSB9KVxuXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLWV4cGxpY2l0LWFueVxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlWG1sKHhtbDogc3RyaW5nKTogYW55IHtcbiAgY29uc3QgcmVzdWx0ID0gZnhwLnBhcnNlKHhtbClcbiAgaWYgKHJlc3VsdC5FcnJvcikge1xuICAgIHRocm93IHJlc3VsdC5FcnJvclxuICB9XG5cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG4vKipcbiAqIGdldCBjb250ZW50IHNpemUgb2Ygb2JqZWN0IGNvbnRlbnQgdG8gdXBsb2FkXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRDb250ZW50TGVuZ3RoKHM6IHN0cmVhbS5SZWFkYWJsZSB8IEJ1ZmZlciB8IHN0cmluZyk6IFByb21pc2U8bnVtYmVyIHwgbnVsbD4ge1xuICAvLyB1c2UgbGVuZ3RoIHByb3BlcnR5IG9mIHN0cmluZyB8IEJ1ZmZlclxuICBpZiAodHlwZW9mIHMgPT09ICdzdHJpbmcnIHx8IEJ1ZmZlci5pc0J1ZmZlcihzKSkge1xuICAgIHJldHVybiBzLmxlbmd0aFxuICB9XG5cbiAgLy8gcHJvcGVydHkgb2YgYGZzLlJlYWRTdHJlYW1gXG4gIGNvbnN0IGZpbGVQYXRoID0gKHMgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikucGF0aCBhcyBzdHJpbmcgfCB1bmRlZmluZWRcbiAgaWYgKGZpbGVQYXRoICYmIHR5cGVvZiBmaWxlUGF0aCA9PT0gJ3N0cmluZycpIHtcbiAgICBjb25zdCBzdGF0ID0gYXdhaXQgZnNwLmxzdGF0KGZpbGVQYXRoKVxuICAgIHJldHVybiBzdGF0LnNpemVcbiAgfVxuXG4gIC8vIHByb3BlcnR5IG9mIGBmcy5SZWFkU3RyZWFtYFxuICBjb25zdCBmZCA9IChzIGFzIHVua25vd24gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLmZkIGFzIG51bWJlciB8IG51bGwgfCB1bmRlZmluZWRcbiAgaWYgKGZkICYmIHR5cGVvZiBmZCA9PT0gJ251bWJlcicpIHtcbiAgICBjb25zdCBzdGF0ID0gYXdhaXQgZnN0YXQoZmQpXG4gICAgcmV0dXJuIHN0YXQuc2l6ZVxuICB9XG5c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