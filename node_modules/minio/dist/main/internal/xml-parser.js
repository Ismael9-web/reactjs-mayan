"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.parseBucketEncryptionConfig = parseBucketEncryptionConfig;
exports.parseBucketRegion = parseBucketRegion;
exports.parseBucketVersioningConfig = parseBucketVersioningConfig;
exports.parseCompleteMultipart = parseCompleteMultipart;
exports.parseCopyObject = parseCopyObject;
exports.parseError = parseError;
exports.parseInitiateMultipart = parseInitiateMultipart;
exports.parseLifecycleConfig = parseLifecycleConfig;
exports.parseListBucket = parseListBucket;
exports.parseListMultipart = parseListMultipart;
exports.parseListObjects = parseListObjects;
exports.parseListObjectsV2WithMetadata = parseListObjectsV2WithMetadata;
exports.parseListParts = parseListParts;
exports.parseObjectLegalHoldConfig = parseObjectLegalHoldConfig;
exports.parseObjectLockConfig = parseObjectLockConfig;
exports.parseObjectRetentionConfig = parseObjectRetentionConfig;
exports.parseReplicationConfig = parseReplicationConfig;
exports.parseResponseError = parseResponseError;
exports.parseSelectObjectContentResponse = parseSelectObjectContentResponse;
exports.parseTagging = parseTagging;
exports.removeObjectsParser = removeObjectsParser;
exports.uploadPartParser = uploadPartParser;
var _bufferCrc = require("buffer-crc32");
var _fastXmlParser = require("fast-xml-parser");
var errors = _interopRequireWildcard(require("../errors.js"), true);
var _helpers = require("../helpers.js");
var _helper = require("./helper.js");
var _response = require("./response.js");
var _type = require("./type.js");
function _getRequireWildcardCache(nodeInterop) { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap(); var cacheNodeInterop = new WeakMap(); return (_getRequireWildcardCache = function (nodeInterop) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); }
function _interopRequireWildcard(obj, nodeInterop) { if (!nodeInterop && obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }
// parse XML response for bucket region
function parseBucketRegion(xml) {
  // return region information
  return (0, _helper.parseXml)(xml).LocationConstraint;
}
const fxp = new _fastXmlParser.XMLParser();
const fxpWithoutNumParser = new _fastXmlParser.XMLParser({
  // @ts-ignore
  numberParseOptions: {
    skipLike: /./
  }
});

// Parse XML and return information as Javascript types
// parse error XML response
function parseError(xml, headerInfo) {
  let xmlErr = {};
  const xmlObj = fxp.parse(xml);
  if (xmlObj.Error) {
    xmlErr = xmlObj.Error;
  }
  const e = new errors.S3Error();
  Object.entries(xmlErr).forEach(([key, value]) => {
    e[key.toLowerCase()] = value;
  });
  Object.entries(headerInfo).forEach(([key, value]) => {
    e[key] = value;
  });
  return e;
}

// Generates an Error object depending on http statusCode and XML body
async function parseResponseError(response) {
  const statusCode = response.statusCode;
  let code = '',
    message = '';
  if (statusCode === 301) {
    code = 'MovedPermanently';
    message = 'Moved Permanently';
  } else if (statusCode === 307) {
    code = 'TemporaryRedirect';
    message = 'Are you using the correct endpoint URL?';
  } else if (statusCode === 403) {
    code = 'AccessDenied';
    message = 'Valid and authorized credentials required';
  } else if (statusCode === 404) {
    code = 'NotFound';
    message = 'Not Found';
  } else if (statusCode === 405) {
    code = 'MethodNotAllowed';
    message = 'Method Not Allowed';
  } else if (statusCode === 501) {
    code = 'MethodNotAllowed';
    message = 'Method Not Allowed';
  } else if (statusCode === 503) {
    code = 'SlowDown';
    message = 'Please reduce your request rate.';
  } else {
    const hErrCode = response.headers['x-minio-error-code'];
    const hErrDesc = response.headers['x-minio-error-desc'];
    if (hErrCode && hErrDesc) {
      code = hErrCode;
      message = hErrDesc;
    }
  }
  const headerInfo = {};
  // A value created by S3 compatible server that uniquely identifies the request.
  headerInfo.amzRequestid = response.headers['x-amz-request-id'];
  // A special token that helps troubleshoot API replies and issues.
  headerInfo.amzId2 = response.headers['x-amz-id-2'];

  // Region where the bucket is located. This header is returned only
  // in HEAD bucket and ListObjects response.
  headerInfo.amzBucketRegion = response.headers['x-amz-bucket-region'];
  const xmlString = await (0, _response.readAsString)(response);
  if (xmlString) {
    throw parseError(xmlString, headerInfo);
  }

  // Message should be instantiated for each S3Errors.
  const e = new errors.S3Error(message, {
    cause: headerInfo
  });
  // S3 Error code.
  e.code = code;
  Object.entries(headerInfo).forEach(([key, value]) => {
    // @ts-expect-error force set error properties
    e[key] = value;
  });
  throw e;
}

/**
 * parse XML response for list objects v2 with metadata in a bucket
 */
function parseListObjectsV2WithMetadata(xml) {
  const result = {
    objects: [],
    isTruncated: false,
    nextContinuationToken: ''
  };
  let xmlobj = (0, _helper.parseXml)(xml);
  if (!xmlobj.ListBucketResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListBucketResult"');
  }
  xmlobj = xmlobj.ListBucketResult;
  if (xmlobj.IsTruncated) {
    result.isTruncated = xmlobj.IsTruncated;
  }
  if (xmlobj.NextContinuationToken) {
    result.nextContinuationToken = xmlobj.NextContinuationToken;
  }
  if (xmlobj.Contents) {
    (0, _helper.toArray)(xmlobj.Contents).forEach(content => {
      const name = (0, _helper.sanitizeObjectKey)(content.Key);
      const lastModified = new Date(content.LastModified);
      const etag = (0, _helper.sanitizeETag)(content.ETag);
      const size = content.Size;
      let tags = {};
      if (content.UserTags != null) {
        (0, _helper.toArray)(content.UserTags.split('&')).forEach(tag => {
          const [key, value] = tag.split('=');
          tags[key] = value;
        });
      } else {
        tags = {};
      }
      let metadata;
      if (content.UserMetadata != null) {
        metadata = (0, _helper.toArray)(content.UserMetadata)[0];
      } else {
        metadata = null;
      }
      result.objects.push({
        name,
        lastModified,
        etag,
        size,
        metadata,
        tags
      });
    });
  }
  if (xmlobj.CommonPrefixes) {
    (0, _helper.toArray)(xmlobj.CommonPrefixes).forEach(commonPrefix => {
      result.objects.push({
        prefix: (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(commonPrefix.Prefix)[0]),
        size: 0
      });
    });
  }
  return result;
}
// parse XML response for list parts of an in progress multipart upload
function parseListParts(xml) {
  let xmlobj = (0, _helper.parseXml)(xml);
  const result = {
    isTruncated: false,
    parts: [],
    marker: 0
  };
  if (!xmlobj.ListPartsResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListPartsResult"');
  }
  xmlobj = xmlobj.ListPartsResult;
  if (xmlobj.IsTruncated) {
    result.isTruncated = xmlobj.IsTruncated;
  }
  if (xmlobj.NextPartNumberMarker) {
    result.marker = (0, _helper.toArray)(xmlobj.NextPartNumberMarker)[0] || '';
  }
  if (xmlobj.Part) {
    (0, _helper.toArray)(xmlobj.Part).forEach(p => {
      const part = parseInt((0, _helper.toArray)(p.PartNumber)[0], 10);
      const lastModified = new Date(p.LastModified);
      const etag = p.ETag.replace(/^"/g, '').replace(/"$/g, '').replace(/^&quot;/g, '').replace(/&quot;$/g, '').replace(/^&#34;/g, '').replace(/&#34;$/g, '');
      result.parts.push({
        part,
        lastModified,
        etag,
        size: parseInt(p.Size, 10)
      });
    });
  }
  return result;
}
function parseListBucket(xml) {
  let result = [];
  const listBucketResultParser = new _fastXmlParser.XMLParser({
    parseTagValue: true,
    // Enable parsing of values
    numberParseOptions: {
      leadingZeros: false,
      // Disable number parsing for values with leading zeros
      hex: false,
      // Disable hex number parsing - Invalid bucket name
      skipLike: /^[0-9]+$/ // Skip number parsing if the value consists entirely of digits
    },

    tagValueProcessor: (tagName, tagValue = '') => {
      // Ensure that the Name tag is always treated as a string
      if (tagName === 'Name') {
        return tagValue.toString();
      }
      return tagValue;
    },
    ignoreAttributes: false // Ensure that all attributes are parsed
  });

  const parsedXmlRes = listBucketResultParser.parse(xml);
  if (!parsedXmlRes.ListAllMyBucketsResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListAllMyBucketsResult"');
  }
  const {
    ListAllMyBucketsResult: {
      Buckets = {}
    } = {}
  } = parsedXmlRes;
  if (Buckets.Bucket) {
    result = (0, _helper.toArray)(Buckets.Bucket).map((bucket = {}) => {
      const {
        Name: bucketName,
        CreationDate
      } = bucket;
      const creationDate = new Date(CreationDate);
      return {
        name: bucketName,
        creationDate
      };
    });
  }
  return result;
}
function parseInitiateMultipart(xml) {
  let xmlobj = (0, _helper.parseXml)(xml);
  if (!xmlobj.InitiateMultipartUploadResult) {
    throw new errors.InvalidXMLError('Missing tag: "InitiateMultipartUploadResult"');
  }
  xmlobj = xmlobj.InitiateMultipartUploadResult;
  if (xmlobj.UploadId) {
    return xmlobj.UploadId;
  }
  throw new errors.InvalidXMLError('Missing tag: "UploadId"');
}
function parseReplicationConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  const {
    Role,
    Rule
  } = xmlObj.ReplicationConfiguration;
  return {
    ReplicationConfiguration: {
      role: Role,
      rules: (0, _helper.toArray)(Rule)
    }
  };
}
function parseObjectLegalHoldConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  return xmlObj.LegalHold;
}
function parseTagging(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  let result = [];
  if (xmlObj.Tagging && xmlObj.Tagging.TagSet && xmlObj.Tagging.TagSet.Tag) {
    const tagResult = xmlObj.Tagging.TagSet.Tag;
    // if it is a single tag convert into an array so that the return value is always an array.
    if ((0, _helper.isObject)(tagResult)) {
      result.push(tagResult);
    } else {
      result = tagResult;
    }
  }
  return result;
}

// parse XML response when a multipart upload is completed
function parseCompleteMultipart(xml) {
  const xmlobj = (0, _helper.parseXml)(xml).CompleteMultipartUploadResult;
  if (xmlobj.Location) {
    const location = (0, _helper.toArray)(xmlobj.Location)[0];
    const bucket = (0, _helper.toArray)(xmlobj.Bucket)[0];
    const key = xmlobj.Key;
    const etag = xmlobj.ETag.replace(/^"/g, '').replace(/"$/g, '').replace(/^&quot;/g, '').replace(/&quot;$/g, '').replace(/^&#34;/g, '').replace(/&#34;$/g, '');
    return {
      location,
      bucket,
      key,
      etag
    };
  }
  // Complete Multipart can return XML Error after a 200 OK response
  if (xmlobj.Code && xmlobj.Message) {
    const errCode = (0, _helper.toArray)(xmlobj.Code)[0];
    const errMessage = (0, _helper.toArray)(xmlobj.Message)[0];
    return {
      errCode,
      errMessage
    };
  }
}
// parse XML response for listing in-progress multipart uploads
function parseListMultipart(xml) {
  const result = {
    prefixes: [],
    uploads: [],
    isTruncated: false,
    nextKeyMarker: '',
    nextUploadIdMarker: ''
  };
  let xmlobj = (0, _helper.parseXml)(xml);
  if (!xmlobj.ListMultipartUploadsResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListMultipartUploadsResult"');
  }
  xmlobj = xmlobj.ListMultipartUploadsResult;
  if (xmlobj.IsTruncated) {
    result.isTruncated = xmlobj.IsTruncated;
  }
  if (xmlobj.NextKeyMarker) {
    result.nextKeyMarker = xmlobj.NextKeyMarker;
  }
  if (xmlobj.NextUploadIdMarker) {
    result.nextUploadIdMarker = xmlobj.nextUploadIdMarker || '';
  }
  if (xmlobj.CommonPrefixes) {
    (0, _helper.toArray)(xmlobj.CommonPrefixes).forEach(prefix => {
      // @ts-expect-error index check
      result.prefixes.push({
        prefix: (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(prefix.Prefix)[0])
      });
    });
  }
  if (xmlobj.Upload) {
    (0, _helper.toArray)(xmlobj.Upload).forEach(upload => {
      const uploadItem = {
        key: upload.Key,
        uploadId: upload.UploadId,
        storageClass: upload.StorageClass,
        initiated: new Date(upload.Initiated)
      };
      if (upload.Initiator) {
        uploadItem.initiator = {
          id: upload.Initiator.ID,
          displayName: upload.Initiator.DisplayName
        };
      }
      if (upload.Owner) {
        uploadItem.owner = {
          id: upload.Owner.ID,
          displayName: upload.Owner.DisplayName
        };
      }
      result.uploads.push(uploadItem);
    });
  }
  return result;
}
function parseObjectLockConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  let lockConfigResult = {};
  if (xmlObj.ObjectLockConfiguration) {
    lockConfigResult = {
      objectLockEnabled: xmlObj.ObjectLockConfiguration.ObjectLockEnabled
    };
    let retentionResp;
    if (xmlObj.ObjectLockConfiguration && xmlObj.ObjectLockConfiguration.Rule && xmlObj.ObjectLockConfiguration.Rule.DefaultRetention) {
      retentionResp = xmlObj.ObjectLockConfiguration.Rule.DefaultRetention || {};
      lockConfigResult.mode = retentionResp.Mode;
    }
    if (retentionResp) {
      const isUnitYears = retentionResp.Years;
      if (isUnitYears) {
        lockConfigResult.validity = isUnitYears;
        lockConfigResult.unit = _type.RETENTION_VALIDITY_UNITS.YEARS;
      } else {
        lockConfigResult.validity = retentionResp.Days;
        lockConfigResult.unit = _type.RETENTION_VALIDITY_UNITS.DAYS;
      }
    }
  }
  return lockConfigResult;
}
function parseBucketVersioningConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  return xmlObj.VersioningConfiguration;
}

// Used only in selectObjectContent API.
// extractHeaderType extracts the first half of the header message, the header type.
function extractHeaderType(stream) {
  const headerNameLen = Buffer.from(stream.read(1)).readUInt8();
  const headerNameWithSeparator = Buffer.from(stream.read(headerNameLen)).toString();
  const splitBySeparator = (headerNameWithSeparator || '').split(':');
  return splitBySeparator.length >= 1 ? splitBySeparator[1] : '';
}
function extractHeaderValue(stream) {
  const bodyLen = Buffer.from(stream.read(2)).readUInt16BE();
  return Buffer.from(stream.read(bodyLen)).toString();
}
function parseSelectObjectContentResponse(res) {
  const selectResults = new _helpers.SelectResults({}); // will be returned

  const responseStream = (0, _helper.readableStream)(res); // convert byte array to a readable responseStream
  // @ts-ignore
  while (responseStream._readableState.length) {
    // Top level responseStream read tracker.
    let msgCrcAccumulator; // accumulate from start of the message till the message crc start.

    const totalByteLengthBuffer = Buffer.from(responseStream.read(4));
    msgCrcAccumulator = _bufferCrc(totalByteLengthBuffer);
    const headerBytesBuffer = Buffer.from(responseStream.read(4));
    msgCrcAccumulator = _bufferCrc(headerBytesBuffer, msgCrcAccumulator);
    const calculatedPreludeCrc = msgCrcAccumulator.readInt32BE(); // use it to check if any CRC mismatch in header itself.

    const preludeCrcBuffer = Buffer.from(responseStream.read(4)); // read 4 bytes    i.e 4+4 =8 + 4 = 12 ( prelude + prelude crc)
    msgCrcAccumulator = _bufferCrc(preludeCrcBuffer, msgCrcAccumulator);
    const totalMsgLength = totalByteLengthBuffer.readInt32BE();
    const headerLength = headerBytesBuffer.readInt32BE();
    const preludeCrcByteValue = preludeCrcBuffer.readInt32BE();
    if (preludeCrcByteValue !== calculatedPreludeCrc) {
      // Handle Header CRC mismatch Error
      throw new Error(`Header Checksum Mismatch, Prelude CRC of ${preludeCrcByteValue} does not equal expected CRC of ${calculatedPreludeCrc}`);
    }
    const headers = {};
    if (headerLength > 0) {
      const headerBytes = Buffer.from(responseStream.read(headerLength));
      msgCrcAccumulator = _bufferCrc(headerBytes, msgCrcAccumulator);
      const headerReaderStream = (0, _helper.readableStream)(headerBytes);
      // @ts-ignore
      while (headerReaderStream._readableState.length) {
        const headerTypeName = extractHeaderType(headerReaderStream);
        headerReaderStream.read(1); // just read and ignore it.
        if (headerTypeName) {
          headers[headerTypeName] = extractHeaderValue(headerReaderStream);
        }
      }
    }
    let payloadStream;
    const payLoadLength = totalMsgLength - headerLength - 16;
    if (payLoadLength > 0) {
      const payLoadBuffer = Buffer.from(responseStream.read(payLoadLength));
      msgCrcAccumulator = _bufferCrc(payLoadBuffer, msgCrcAccumulator);
      // read the checksum early and detect any mismatch so we can avoid unnecessary further processing.
      const messageCrcByteValue = Buffer.from(responseStream.read(4)).readInt32BE();
      const calculatedCrc = msgCrcAccumulator.readInt32BE();
      // Handle message CRC Error
      if (messageCrcByteValue !== calculatedCrc) {
        throw new Error(`Message Checksum Mismatch, Message CRC of ${messageCrcByteValue} does not equal expected CRC of ${calculatedCrc}`);
      }
      payloadStream = (0, _helper.readableStream)(payLoadBuffer);
    }
    const messageType = headers['message-type'];
    switch (messageType) {
      case 'error':
        {
          const errorMessage = headers['error-code'] + ':"' + headers['error-message'] + '"';
          throw new Error(errorMessage);
        }
      case 'event':
        {
          const contentType = headers['content-type'];
          const eventType = headers['event-type'];
          switch (eventType) {
            case 'End':
              {
                selectResults.setResponse(res);
                return selectResults;
              }
            case 'Records':
              {
                var _payloadStream;
                const readData = (_payloadStream = payloadStream) === null || _payloadStream === void 0 ? void 0 : _payloadStream.read(payLoadLength);
                selectResults.setRecords(readData);
                break;
              }
            case 'Progress':
              {
                switch (contentType) {
                  case 'text/xml':
                    {
                      var _payloadStream2;
                      const progressData = (_payloadStream2 = payloadStream) === null || _payloadStream2 === void 0 ? void 0 : _payloadStream2.read(payLoadLength);
                      selectResults.setProgress(progressData.toString());
                      break;
                    }
                  default:
                    {
                      const errorMessage = `Unexpected content-type ${contentType} sent for event-type Progress`;
                      throw new Error(errorMessage);
                    }
                }
              }
              break;
            case 'Stats':
              {
                switch (contentType) {
                  case 'text/xml':
                    {
                      var _payloadStream3;
                      const statsData = (_payloadStream3 = payloadStream) === null || _payloadStream3 === void 0 ? void 0 : _payloadStream3.read(payLoadLength);
                      selectResults.setStats(statsData.toString());
                      break;
                    }
                  default:
                    {
                      const errorMessage = `Unexpected content-type ${contentType} sent for event-type Stats`;
                      throw new Error(errorMessage);
                    }
                }
              }
              break;
            default:
              {
                // Continuation message: Not sure if it is supported. did not find a reference or any message in response.
                // It does not have a payload.
                const warningMessage = `Un implemented event detected  ${messageType}.`;
                // eslint-disable-next-line no-console
                console.warn(warningMessage);
              }
          }
        }
    }
  }
}
function parseLifecycleConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  return xmlObj.LifecycleConfiguration;
}
function parseBucketEncryptionConfig(xml) {
  return (0, _helper.parseXml)(xml);
}
function parseObjectRetentionConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  const retentionConfig = xmlObj.Retention;
  return {
    mode: retentionConfig.Mode,
    retainUntilDate: retentionConfig.RetainUntilDate
  };
}
function removeObjectsParser(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  if (xmlObj.DeleteResult && xmlObj.DeleteResult.Error) {
    // return errors as array always. as the response is object in case of single object passed in removeObjects
    return (0, _helper.toArray)(xmlObj.DeleteResult.Error);
  }
  return [];
}

// parse XML response for copy object
function parseCopyObject(xml) {
  const result = {
    etag: '',
    lastModified: ''
  };
  let xmlobj = (0, _helper.parseXml)(xml);
  if (!xmlobj.CopyObjectResult) {
    throw new errors.InvalidXMLError('Missing tag: "CopyObjectResult"');
  }
  xmlobj = xmlobj.CopyObjectResult;
  if (xmlobj.ETag) {
    result.etag = xmlobj.ETag.replace(/^"/g, '').replace(/"$/g, '').replace(/^&quot;/g, '').replace(/&quot;$/g, '').replace(/^&#34;/g, '').replace(/&#34;$/g, '');
  }
  if (xmlobj.LastModified) {
    result.lastModified = new Date(xmlobj.LastModified);
  }
  return result;
}
const formatObjInfo = (content, opts = {}) => {
  const {
    Key,
    LastModified,
    ETag,
    Size,
    VersionId,
    IsLatest
  } = content;
  if (!(0, _helper.isObject)(opts)) {
    opts = {};
  }
  const name = (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(Key)[0] || '');
  const lastModified = LastModified ? new Date((0, _helper.toArray)(LastModified)[0] || '') : undefined;
  const etag = (0, _helper.sanitizeETag)((0, _helper.toArray)(ETag)[0] || '');
  const size = (0, _helper.sanitizeSize)(Size || '');
  return {
    name,
    lastModified,
    etag,
    size,
    versionId: VersionId,
    isLatest: IsLatest,
    isDeleteMarker: opts.IsDeleteMarker ? opts.IsDeleteMarker : false
  };
};

// parse XML response for list objects in a bucket
function parseListObjects(xml) {
  const result = {
    objects: [],
    isTruncated: false,
    nextMarker: undefined,
    versionIdMarker: undefined
  };
  let isTruncated = false;
  let nextMarker, nextVersionKeyMarker;
  const xmlobj = fxpWithoutNumParser.parse(xml);
  const parseCommonPrefixesEntity = commonPrefixEntry => {
    if (commonPrefixEntry) {
      (0, _helper.toArray)(commonPrefixEntry).forEach(commonPrefix => {
        result.objects.push({
          prefix: (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(commonPrefix.Prefix)[0] || ''),
          size: 0
        });
      });
    }
  };
  const listBucketResult = xmlobj.ListBucketResult;
  const listVersionsResult = xmlobj.ListVersionsResult;
  if (listBucketResult) {
    if (listBucketResult.IsTruncated) {
      isTruncated = listBucketResult.IsTruncated;
    }
    if (listBucketResult.Contents) {
      (0, _helper.toArray)(listBucketResult.Contents).forEach(content => {
        const name = (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(content.Key)[0] || '');
        const lastModified = new Date((0, _helper.toArray)(content.LastModified)[0] || '');
        const etag = (0, _helper.sanitizeETag)((0, _helper.toArray)(content.ETag)[0] || '');
        const size = (0, _helper.sanitizeSize)(content.Size || '');
        result.objects.push({
          name,
          lastModified,
          etag,
          size
        });
      });
    }
    if (listBucketResult.Marker) {
      nextMarker = listBucketResult.Marker;
    } else if (isTruncated && result.objects.length > 0) {
      var _result$objects;
      nextMarker = (_result$objects = result.objects[result.objects.length - 1]) === null || _result$objects === void 0 ? void 0 : _result$objects.name;
    }
    if (listBucketResult.CommonPrefixes) {
      parseCommonPrefixesEntity(listBucketResult.CommonPrefixes);
    }
  }
  if (listVersionsResult) {
    if (listVersionsResult.IsTruncated) {
      isTruncated = listVersionsResult.IsTruncated;
    }
    if (listVersionsResult.Version) {
      (0, _helper.toArray)(listVersionsResult.Version).forEach(content => {
        result.objects.push(formatObjInfo(content));
      });
    }
    if (listVersionsResult.DeleteMarker) {
      (0, _helper.toArray)(listVersionsResult.DeleteMarker).forEach(content => {
        result.objects.push(formatObjInfo(content, {
          IsDeleteMarker: true
        }));
      });
    }
    if (listVersionsResult.NextKeyMarker) {
      nextVersionKeyMarker = listVersionsResult.NextKeyMarker;
    }
    if (listVersionsResult.NextVersionIdMarker) {
      result.versionIdMarker = listVersionsResult.NextVersionIdMarker;
    }
    if (listVersionsResult.CommonPrefixes) {
      parseCommonPrefixesEntity(listVersionsResult.CommonPrefixes);
    }
  }
  result.isTruncated = isTruncated;
  if (isTruncated) {
    result.nextMarker = nextVersionKeyMarker || nextMarker;
  }
  return result;
}
function uploadPartParser(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  const respEl = xmlObj.CopyPartResult;
  return respEl;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfYnVmZmVyQ3JjIiwicmVxdWlyZSIsIl9mYXN0WG1sUGFyc2VyIiwiZXJyb3JzIiwiX2ludGVyb3BSZXF1aXJlV2lsZGNhcmQiLCJfaGVscGVycyIsIl9oZWxwZXIiLCJfcmVzcG9uc2UiLCJfdHlwZSIsIl9nZXRSZXF1aXJlV2lsZGNhcmRDYWNoZSIsIm5vZGVJbnRlcm9wIiwiV2Vha01hcCIsImNhY2hlQmFiZWxJbnRlcm9wIiwiY2FjaGVOb2RlSW50ZXJvcCIsIm9iaiIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiY2FjaGUiLCJoYXMiLCJnZXQiLCJuZXdPYmoiLCJoYXNQcm9wZXJ0eURlc2NyaXB0b3IiLCJPYmplY3QiLCJkZWZpbmVQcm9wZXJ0eSIsImdldE93blByb3BlcnR5RGVzY3JpcHRvciIsImtleSIsInByb3RvdHlwZSIsImhhc093blByb3BlcnR5IiwiY2FsbCIsImRlc2MiLCJzZXQiLCJwYXJzZUJ1Y2tldFJlZ2lvbiIsInhtbCIsInBhcnNlWG1sIiwiTG9jYXRpb25Db25zdHJhaW50IiwiZnhwIiwiWE1MUGFyc2VyIiwiZnhwV2l0aG91dE51bVBhcnNlciIsIm51bWJlclBhcnNlT3B0aW9ucyIsInNraXBMaWtlIiwicGFyc2VFcnJvciIsImhlYWRlckluZm8iLCJ4bWxFcnIiLCJ4bWxPYmoiLCJwYXJzZSIsIkVycm9yIiwiZSIsIlMzRXJyb3IiLCJlbnRyaWVzIiwiZm9yRWFjaCIsInZhbHVlIiwidG9Mb3dlckNhc2UiLCJwYXJzZVJlc3BvbnNlRXJyb3IiLCJyZXNwb25zZSIsInN0YXR1c0NvZGUiLCJjb2RlIiwibWVzc2FnZSIsImhFcnJDb2RlIiwiaGVhZGVycyIsImhFcnJEZXNjIiwiYW16UmVxdWVzdGlkIiwiYW16SWQyIiwiYW16QnVja2V0UmVnaW9uIiwieG1sU3RyaW5nIiwicmVhZEFzU3RyaW5nIiwiY2F1c2UiLCJwYXJzZUxpc3RPYmplY3RzVjJXaXRoTWV0YWRhdGEiLCJyZXN1bHQiLCJvYmplY3RzIiwiaXNUcnVuY2F0ZWQiLCJuZXh0Q29udGludWF0aW9uVG9rZW4iLCJ4bWxvYmoiLCJMaXN0QnVja2V0UmVzdWx0IiwiSW52YWxpZFhNTEVycm9yIiwiSXNUcnVuY2F0ZWQiLCJOZXh0Q29udGludWF0aW9uVG9rZW4iLCJDb250ZW50cyIsInRvQXJyYXkiLCJjb250ZW50IiwibmFtZSIsInNhbml0aXplT2JqZWN0S2V5IiwiS2V5IiwibGFzdE1vZGlmaWVkIiwiRGF0ZSIsIkxhc3RNb2RpZmllZCIsImV0YWciLCJzYW5pdGl6ZUVUYWciLCJFVGFnIiwic2l6ZSIsIlNpemUiLCJ0YWdzIiwiVXNlclRhZ3MiLCJzcGxpdCIsInRhZyIsIm1ldGFkYXRhIiwiVXNlck1ldGFkYXRhIiwicHVzaCIsIkNvbW1vblByZWZpeGVzIiwiY29tbW9uUHJlZml4IiwicHJlZml4IiwiUHJlZml4IiwicGFyc2VMaXN0UGFydHMiLCJwYXJ0cyIsIm1hcmtlciIsIkxpc3RQYXJ0c1Jlc3VsdCIsIk5leHRQYXJ0TnVtYmVyTWFya2VyIiwiUGFydCIsInAiLCJwYXJ0IiwicGFyc2VJbnQiLCJQYXJ0TnVtYmVyIiwicmVwbGFjZSIsInBhcnNlTGlzdEJ1Y2tldCIsImxpc3RCdWNrZXRSZXN1bHRQYXJzZXIiLCJwYXJzZVRhZ1ZhbHVlIiwibGVhZGluZ1plcm9zIiwiaGV4IiwidGFnVmFsdWVQcm9jZXNzb3IiLCJ0YWdOYW1lIiwidGFnVmFsdWUiLCJ0b1N0cmluZyIsImlnbm9yZUF0dHJpYnV0ZXMiLCJwYXJzZWRYbWxSZXMiLCJMaXN0QWxsTXlCdWNrZXRzUmVzdWx0IiwiQnVja2V0cyIsIkJ1Y2tldCIsIm1hcCIsImJ1Y2tldCIsIk5hbWUiLCJidWNrZXROYW1lIiwiQ3JlYXRpb25EYXRlIiwiY3JlYXRpb25EYXRlIiwicGFyc2VJbml0aWF0ZU11bHRpcGFydCIsIkluaXRpYXRlTXVsdGlwYXJ0VXBsb2FkUmVzdWx0IiwiVXBsb2FkSWQiLCJwYXJzZVJlcGxpY2F0aW9uQ29uZmlnIiwiUm9sZSIsIlJ1bGUiLCJSZXBsaWNhdGlvbkNvbmZpZ3VyYXRpb24iLCJyb2xlIiwicnVsZXMiLCJwYXJzZU9iamVjdExlZ2FsSG9sZENvbmZpZyIsIkxlZ2FsSG9sZCIsInBhcnNlVGFnZ2luZyIsIlRhZ2dpbmciLCJUYWdTZXQiLCJUYWciLCJ0YWdSZXN1bHQiLCJpc09iamVjdCIsInBhcnNlQ29tcGxldGVNdWx0aXBhcnQiLCJDb21wbGV0ZU11bHRpcGFydFVwbG9hZFJlc3VsdCIsIkxvY2F0aW9uIiwibG9jYXRpb24iLCJDb2RlIiwiTWVzc2FnZSIsImVyckNvZGUiLCJlcnJNZXNzYWdlIiwicGFyc2VMaXN0TXVsdGlwYXJ0IiwicHJlZml4ZXMiLCJ1cGxvYWRzIiwibmV4dEtleU1hcmtlciIsIm5leHRVcGxvYWRJZE1hcmtlciIsIkxpc3RNdWx0aXBhcnRVcGxvYWRzUmVzdWx0IiwiTmV4dEtleU1hcmtlciIsIk5leHRVcGxvYWRJZE1hcmtlciIsIlVwbG9hZCIsInVwbG9hZCIsInVwbG9hZEl0ZW0iLCJ1cGxvYWRJZCIsInN0b3JhZ2VDbGFzcyIsIlN0b3JhZ2VDbGFzcyIsImluaXRpYXRlZCIsIkluaXRpYXRlZCIsIkluaXRpYXRvciIsImluaXRpYXRvciIsImlkIiwiSUQiLCJkaXNwbGF5TmFtZSIsIkRpc3BsYXlOYW1lIiwiT3duZXIiLCJvd25lciIsInBhcnNlT2JqZWN0TG9ja0NvbmZpZyIsImxvY2tDb25maWdSZXN1bHQiLCJPYmplY3RMb2NrQ29uZmlndXJhdGlvbiIsIm9iamVjdExvY2tFbmFibGVkIiwiT2JqZWN0TG9ja0VuYWJsZWQiLCJyZXRlbnRpb25SZXNwIiwiRGVmYXVsdFJldGVudGlvbiIsIm1vZGUiLCJNb2RlIiwiaXNVbml0WWVhcnMiLCJZZWFycyIsInZhbGlkaXR5IiwidW5pdCIsIlJFVEVOVElPTl9WQUxJRElUWV9VTklUUyIsIllFQVJTIiwiRGF5cyIsIkRBWVMiLCJwYXJzZUJ1Y2tldFZlcnNpb25pbmdDb25maWciLCJWZXJzaW9uaW5nQ29uZmlndXJhdGlvbiIsImV4dHJhY3RIZWFkZXJUeXBlIiwic3RyZWFtIiwiaGVhZGVyTmFtZUxlbiIsIkJ1ZmZlciIsImZyb20iLCJyZWFkIiwicmVhZFVJbnQ4IiwiaGVhZGVyTmFtZVdpdGhTZXBhcmF0b3IiLCJzcGxpdEJ5U2VwYXJhdG9yIiwibGVuZ3RoIiwiZXh0cmFjdEhlYWRlclZhbHVlIiwiYm9keUxlbiIsInJlYWRVSW50MTZCRSIsInBhcnNlU2VsZWN0T2JqZWN0Q29udGVudFJlc3BvbnNlIiwicmVzIiwic2VsZWN0UmVzdWx0cyIsIlNlbGVjdFJlc3VsdHMiLCJyZXNwb25zZVN0cmVhbSIsInJlYWRhYmxlU3RyZWFtIiwiX3JlYWRhYmxlU3RhdGUiLCJtc2dDcmNBY2N1bXVsYXRvciIsInRvdGFsQnl0ZUxlbmd0aEJ1ZmZlciIsImNyYzMyIiwiaGVhZGVyQnl0ZXNCdWZmZXIiLCJjYWxjdWxhdGVkUHJlbHVkZUNyYyIsInJlYWRJbnQzMkJFIiwicHJlbHVkZUNyY0J1ZmZlciIsInRvdGFsTXNnTGVuZ3RoIiwiaGVhZGVyTGVuZ3RoIiwicHJlbHVkZUNyY0J5dGVWYWx1ZSIsImhlYWRlckJ5dGVzIiwiaGVhZGVyUmVhZGVyU3RyZWFtIiwiaGVhZGVyVHlwZU5hbWUiLCJwYXlsb2FkU3RyZWFtIiwicGF5TG9hZExlbmd0aCIsInBheUxvYWRCdWZmZXIiLCJtZXNzYWdlQ3JjQnl0ZVZhbHVlIiwiY2FsY3VsYXRlZENyYyIsIm1lc3NhZ2VUeXBlIiwiZXJyb3JNZXNzYWdlIiwiY29udGVudFR5cGUiLCJldmVudFR5cGUiLCJzZXRSZXNwb25zZSIsIl9wYXlsb2FkU3RyZWFtIiwicmVhZERhdGEiLCJzZXRSZWNvcmRzIiwiX3BheWxvYWRTdHJlYW0yIiwicHJvZ3Jlc3NEYXRhIiwic2V0UHJvZ3Jlc3MiLCJfcGF5bG9hZFN0cmVhbTMiLCJzdGF0c0RhdGEiLCJzZXRTdGF0cyIsIndhcm5pbmdNZXNzYWdlIiwiY29uc29sZSIsIndhcm4iLCJwYXJzZUxpZmVjeWNsZUNvbmZpZyIsIkxpZmVjeWNsZUNvbmZpZ3VyYXRpb24iLCJwYXJzZUJ1Y2tldEVuY3J5cHRpb25Db25maWciLCJwYXJzZU9iamVjdFJldGVudGlvbkNvbmZpZyIsInJldGVudGlvbkNvbmZpZyIsIlJldGVudGlvbiIsInJldGFpblVudGlsRGF0ZSIsIlJldGFpblVudGlsRGF0ZSIsInJlbW92ZU9iamVjdHNQYXJzZXIiLCJEZWxldGVSZXN1bHQiLCJwYXJzZUNvcHlPYmplY3QiLCJDb3B5T2JqZWN0UmVzdWx0IiwiZm9ybWF0T2JqSW5mbyIsIm9wdHMiLCJWZXJzaW9uSWQiLCJJc0xhdGVzdCIsInVuZGVmaW5lZCIsInNhbml0aXplU2l6ZSIsInZlcnNpb25JZCIsImlzTGF0ZXN0IiwiaXNEZWxldGVNYXJrZXIiLCJJc0RlbGV0ZU1hcmtlciIsInBhcnNlTGlzdE9iamVjdHMiLCJuZXh0TWFya2VyIiwidmVyc2lvbklkTWFya2VyIiwibmV4dFZlcnNpb25LZXlNYXJrZXIiLCJwYXJzZUNvbW1vblByZWZpeGVzRW50aXR5IiwiY29tbW9uUHJlZml4RW50cnkiLCJsaXN0QnVja2V0UmVzdWx0IiwibGlzdFZlcnNpb25zUmVzdWx0IiwiTGlzdFZlcnNpb25zUmVzdWx0IiwiTWFya2VyIiwiX3Jlc3VsdCRvYmplY3RzIiwiVmVyc2lvbiIsIkRlbGV0ZU1hcmtlciIsIk5leHRWZXJzaW9uSWRNYXJrZXIiLCJ1cGxvYWRQYXJ0UGFyc2VyIiwicmVzcEVsIiwiQ29weVBhcnRSZXN1bHQiXSwic291cmNlcyI6WyJ4bWwtcGFyc2VyLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlICogYXMgaHR0cCBmcm9tICdub2RlOmh0dHAnXG5pbXBvcnQgdHlwZSBzdHJlYW0gZnJvbSAnbm9kZTpzdHJlYW0nXG5cbmltcG9ydCBjcmMzMiBmcm9tICdidWZmZXItY3JjMzInXG5pbXBvcnQgeyBYTUxQYXJzZXIgfSBmcm9tICdmYXN0LXhtbC1wYXJzZXInXG5cbmltcG9ydCAqIGFzIGVycm9ycyBmcm9tICcuLi9lcnJvcnMudHMnXG5pbXBvcnQgeyBTZWxlY3RSZXN1bHRzIH0gZnJvbSAnLi4vaGVscGVycy50cydcbmltcG9ydCB7IGlzT2JqZWN0LCBwYXJzZVhtbCwgcmVhZGFibGVTdHJlYW0sIHNhbml0aXplRVRhZywgc2FuaXRpemVPYmplY3RLZXksIHNhbml0aXplU2l6ZSwgdG9BcnJheSB9IGZyb20gJy4vaGVscGVyLnRzJ1xuaW1wb3J0IHsgcmVhZEFzU3RyaW5nIH0gZnJvbSAnLi9yZXNwb25zZS50cydcbmltcG9ydCB0eXBlIHtcbiAgQnVja2V0SXRlbUZyb21MaXN0LFxuICBCdWNrZXRJdGVtV2l0aE1ldGFkYXRhLFxuICBDb21tb25QcmVmaXgsXG4gIENvcHlPYmplY3RSZXN1bHRWMSxcbiAgTGlzdEJ1Y2tldFJlc3VsdFYxLFxuICBPYmplY3RJbmZvLFxuICBPYmplY3RMb2NrSW5mbyxcbiAgT2JqZWN0Um93RW50cnksXG4gIFJlcGxpY2F0aW9uQ29uZmlnLFxuICBUYWdzLFxufSBmcm9tICcuL3R5cGUudHMnXG5pbXBvcnQgeyBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMgfSBmcm9tICcuL3R5cGUudHMnXG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgYnVja2V0IHJlZ2lvblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQnVja2V0UmVnaW9uKHhtbDogc3RyaW5nKTogc3RyaW5nIHtcbiAgLy8gcmV0dXJuIHJlZ2lvbiBpbmZvcm1hdGlvblxuICByZXR1cm4gcGFyc2VYbWwoeG1sKS5Mb2NhdGlvbkNvbnN0cmFpbnRcbn1cblxuY29uc3QgZnhwID0gbmV3IFhNTFBhcnNlcigpXG5cbmNvbnN0IGZ4cFdpdGhvdXROdW1QYXJzZXIgPSBuZXcgWE1MUGFyc2VyKHtcbiAgLy8gQHRzLWlnbm9yZVxuICBudW1iZXJQYXJzZU9wdGlvbnM6IHtcbiAgICBza2lwTGlrZTogLy4vLFxuICB9LFxufSlcblxuLy8gUGFyc2UgWE1MIGFuZCByZXR1cm4gaW5mb3JtYXRpb24gYXMgSmF2YXNjcmlwdCB0eXBlc1xuLy8gcGFyc2UgZXJyb3IgWE1MIHJlc3BvbnNlXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VFcnJvcih4bWw6IHN0cmluZywgaGVhZGVySW5mbzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pIHtcbiAgbGV0IHhtbEVyciA9IHt9XG4gIGNvbnN0IHhtbE9iaiA9IGZ4cC5wYXJzZSh4bWwpXG4gIGlmICh4bWxPYmouRXJyb3IpIHtcbiAgICB4bWxFcnIgPSB4bWxPYmouRXJyb3JcbiAgfVxuICBjb25zdCBlID0gbmV3IGVycm9ycy5TM0Vycm9yKCkgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICBPYmplY3QuZW50cmllcyh4bWxFcnIpLmZvckVhY2goKFtrZXksIHZhbHVlXSkgPT4ge1xuICAgIGVba2V5LnRvTG93ZXJDYXNlKCldID0gdmFsdWVcbiAgfSlcbiAgT2JqZWN0LmVudHJpZXMoaGVhZGVySW5mbykuZm9yRWFjaCgoW2tleSwgdmFsdWVdKSA9PiB7XG4gICAgZVtrZXldID0gdmFsdWVcbiAgfSlcbiAgcmV0dXJuIGVcbn1cblxuLy8gR2VuZXJhdGVzIGFuIEVycm9yIG9iamVjdCBkZXBlbmRpbmcgb24gaHR0cCBzdGF0dXNDb2RlIGFuZCBYTUwgYm9keVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHBhcnNlUmVzcG9uc2VFcnJvcihyZXNwb25zZTogaHR0cC5JbmNvbWluZ01lc3NhZ2UpOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIHN0cmluZz4+IHtcbiAgY29uc3Qgc3RhdHVzQ29kZSA9IHJlc3BvbnNlLnN0YXR1c0NvZGVcbiAgbGV0IGNvZGUgPSAnJyxcbiAgICBtZXNzYWdlID0gJydcbiAgaWYgKHN0YXR1c0NvZGUgPT09IDMwMSkge1xuICAgIGNvZGUgPSAnTW92ZWRQZXJtYW5lbnRseSdcbiAgICBtZXNzYWdlID0gJ01vdmVkIFBlcm1hbmVudGx5J1xuICB9IGVsc2UgaWYgKHN0YXR1c0NvZGUgPT09IDMwNykge1xuICAgIGNvZGUgPSAnVGVtcG9yYXJ5UmVkaXJlY3QnXG4gICAgbWVzc2FnZSA9ICdBcmUgeW91IHVzaW5nIHRoZSBjb3JyZWN0IGVuZHBvaW50IFVSTD8nXG4gIH0gZWxzZSBpZiAoc3RhdHVzQ29kZSA9PT0gNDAzKSB7XG4gICAgY29kZSA9ICdBY2Nlc3NEZW5pZWQnXG4gICAgbWVzc2FnZSA9ICdWYWxpZCBhbmQgYXV0aG9yaXplZCBjcmVkZW50aWFscyByZXF1aXJlZCdcbiAgfSBlbHNlIGlmIChzdGF0dXNDb2RlID09PSA0MDQpIHtcbiAgICBjb2RlID0gJ05vdEZvdW5kJ1xuICAgIG1lc3NhZ2UgPSAnTm90IEZvdW5kJ1xuICB9IGVsc2UgaWYgKHN0YXR1c0NvZGUgPT09IDQwNSkge1xuICAgIGNvZGUgPSAnTWV0aG9kTm90QWxsb3dlZCdcbiAgICBtZXNzYWdlID0gJ01ldGhvZCBOb3QgQWxsb3dlZCdcbiAgfSBlbHNlIGlmIChzdGF0dXNDb2RlID09PSA1MDEpIHtcbiAgICBjb2RlID0gJ01ldGhvZE5vdEFsbG93ZWQnXG4gICAgbWVzc2FnZSA9ICdNZXRob2QgTm90IEFsbG93ZWQnXG4gIH0gZWxzZSBpZiAoc3RhdHVzQ29kZSA9PT0gNTAzKSB7XG4gICAgY29kZSA9ICdTbG93RG93bidcbiAgICBtZXNzYWdlID0gJ1BsZWFzZSByZWR1Y2UgeW91ciByZXF1ZXN0IHJhdGUuJ1xuICB9IGVsc2Uge1xuICAgIGNvbnN0IGhFcnJDb2RlID0gcmVzcG9uc2UuaGVhZGVyc1sneC1taW5pby1lcnJvci1jb2RlJ10gYXMgc3RyaW5nXG4gICAgY29uc3QgaEVyckRlc2MgPSByZXNwb25zZS5oZWFkZXJzWyd4LW1pbmlvLWVycm9yLWRlc2MnXSBhcyBzdHJpbmdcblxuICAgIGlmIChoRXJyQ29kZSAmJiBoRXJyRGVzYykge1xuICAgICAgY29kZSA9IGhFcnJDb2RlXG4gICAgICBtZXNzYWdlID0gaEVyckRlc2NcbiAgICB9XG4gIH1cbiAgY29uc3QgaGVhZGVySW5mbzogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbD4gPSB7fVxuICAvLyBBIHZhbHVlIGNyZWF0ZWQgYnkgUzMgY29tcGF0aWJsZSBzZXJ2ZXIgdGhhdCB1bmlxdWVseSBpZGVudGlmaWVzIHRoZSByZXF1ZXN0LlxuICBoZWFkZXJJbmZvLmFtelJlcXVlc3RpZCA9IHJlc3BvbnNlLmhlYWRlcnNbJ3gtYW16LXJlcXVlc3QtaWQnXSBhcyBzdHJpbmcgfCB1bmRlZmluZWRcbiAgLy8gQSBzcGVjaWFsIHRva2VuIHRoYXQgaGVscHMgdHJvdWJsZXNob290IEFQSSByZXBsaWVzIGFuZCBpc3N1ZXMuXG4gIGhlYWRlckluZm8uYW16SWQyID0gcmVzcG9uc2UuaGVhZGVyc1sneC1hbXotaWQtMiddIGFzIHN0cmluZyB8IHVuZGVmaW5lZFxuXG4gIC8vIFJlZ2lvbiB3aGVyZSB0aGUgYnVja2V0IGlzIGxvY2F0ZWQuIFRoaXMgaGVhZGVyIGlzIHJldHVybmVkIG9ubHlcbiAgLy8gaW4gSEVBRCBidWNrZXQgYW5kIExpc3RPYmplY3RzIHJlc3BvbnNlLlxuICBoZWFkZXJJbmZvLmFtekJ1Y2tldFJlZ2lvbiA9IHJlc3BvbnNlLmhlYWRlcnNbJ3gtYW16LWJ1Y2tldC1yZWdpb24nXSBhcyBzdHJpbmcgfCB1bmRlZmluZWRcblxuICBjb25zdCB4bWxTdHJpbmcgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzcG9uc2UpXG5cbiAgaWYgKHhtbFN0cmluZykge1xuICAgIHRocm93IHBhcnNlRXJyb3IoeG1sU3RyaW5nLCBoZWFkZXJJbmZvKVxuICB9XG5cbiAgLy8gTWVzc2FnZSBzaG91bGQgYmUgaW5zdGFudGlhdGVkIGZvciBlYWNoIFMzRXJyb3JzLlxuICBjb25zdCBlID0gbmV3IGVycm9ycy5TM0Vycm9yKG1lc3NhZ2UsIHsgY2F1c2U6IGhlYWRlckluZm8gfSlcbiAgLy8gUzMgRXJyb3IgY29kZS5cbiAgZS5jb2RlID0gY29kZVxuICBPYmplY3QuZW50cmllcyhoZWFkZXJJbmZvKS5mb3JFYWNoKChba2V5LCB2YWx1ZV0pID0+IHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yIGZvcmNlIHNldCBlcnJvciBwcm9wZXJ0aWVzXG4gICAgZVtrZXldID0gdmFsdWVcbiAgfSlcblxuICB0aHJvdyBlXG59XG5cbi8qKlxuICogcGFyc2UgWE1MIHJlc3BvbnNlIGZvciBsaXN0IG9iamVjdHMgdjIgd2l0aCBtZXRhZGF0YSBpbiBhIGJ1Y2tldFxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhKHhtbDogc3RyaW5nKSB7XG4gIGNvbnN0IHJlc3VsdDoge1xuICAgIG9iamVjdHM6IEFycmF5PEJ1Y2tldEl0ZW1XaXRoTWV0YWRhdGE+XG4gICAgaXNUcnVuY2F0ZWQ6IGJvb2xlYW5cbiAgICBuZXh0Q29udGludWF0aW9uVG9rZW46IHN0cmluZ1xuICB9ID0ge1xuICAgIG9iamVjdHM6IFtdLFxuICAgIGlzVHJ1bmNhdGVkOiBmYWxzZSxcbiAgICBuZXh0Q29udGludWF0aW9uVG9rZW46ICcnLFxuICB9XG5cbiAgbGV0IHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcbiAgaWYgKCF4bWxvYmouTGlzdEJ1Y2tldFJlc3VsdCkge1xuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJMaXN0QnVja2V0UmVzdWx0XCInKVxuICB9XG4gIHhtbG9iaiA9IHhtbG9iai5MaXN0QnVja2V0UmVzdWx0XG4gIGlmICh4bWxvYmouSXNUcnVuY2F0ZWQpIHtcbiAgICByZXN1bHQuaXNUcnVuY2F0ZWQgPSB4bWxvYmouSXNUcnVuY2F0ZWRcbiAgfVxuICBpZiAoeG1sb2JqLk5leHRDb250aW51YXRpb25Ub2tlbikge1xuICAgIHJlc3VsdC5uZXh0Q29udGludWF0aW9uVG9rZW4gPSB4bWxvYmouTmV4dENvbnRpbnVhdGlvblRva2VuXG4gIH1cblxuICBpZiAoeG1sb2JqLkNvbnRlbnRzKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ29udGVudHMpLmZvckVhY2goKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IG5hbWUgPSBzYW5pdGl6ZU9iamVjdEtleShjb250ZW50LktleSlcbiAgICAgIGNvbnN0IGxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKGNvbnRlbnQuTGFzdE1vZGlmaWVkKVxuICAgICAgY29uc3QgZXRhZyA9IHNhbml0aXplRVRhZyhjb250ZW50LkVUYWcpXG4gICAgICBjb25zdCBzaXplID0gY29udGVudC5TaXplXG5cbiAgICAgIGxldCB0YWdzOiBUYWdzID0ge31cbiAgICAgIGlmIChjb250ZW50LlVzZXJUYWdzICE9IG51bGwpIHtcbiAgICAgICAgdG9BcnJheShjb250ZW50LlVzZXJUYWdzLnNwbGl0KCcmJykpLmZvckVhY2goKHRhZykgPT4ge1xuICAgICAgICAgIGNvbnN0IFtrZXksIHZhbHVlXSA9IHRhZy5zcGxpdCgnPScpXG4gICAgICAgICAgdGFnc1trZXldID0gdmFsdWVcbiAgICAgICAgfSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRhZ3MgPSB7fVxuICAgICAgfVxuXG4gICAgICBsZXQgbWV0YWRhdGFcbiAgICAgIGlmIChjb250ZW50LlVzZXJNZXRhZGF0YSAhPSBudWxsKSB7XG4gICAgICAgIG1ldGFkYXRhID0gdG9BcnJheShjb250ZW50LlVzZXJNZXRhZGF0YSlbMF1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1ldGFkYXRhID0gbnVsbFxuICAgICAgfVxuICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IG5hbWUsIGxhc3RNb2RpZmllZCwgZXRhZywgc2l6ZSwgbWV0YWRhdGEsIHRhZ3MgfSlcbiAgICB9KVxuICB9XG5cbiAgaWYgKHhtbG9iai5Db21tb25QcmVmaXhlcykge1xuICAgIHRvQXJyYXkoeG1sb2JqLkNvbW1vblByZWZpeGVzKS5mb3JFYWNoKChjb21tb25QcmVmaXgpID0+IHtcbiAgICAgIHJlc3VsdC5vYmplY3RzLnB1c2goeyBwcmVmaXg6IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXkoY29tbW9uUHJlZml4LlByZWZpeClbMF0pLCBzaXplOiAwIH0pXG4gICAgfSlcbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbmV4cG9ydCB0eXBlIFVwbG9hZGVkUGFydCA9IHtcbiAgcGFydDogbnVtYmVyXG4gIGxhc3RNb2RpZmllZD86IERhdGVcbiAgZXRhZzogc3RyaW5nXG4gIHNpemU6IG51bWJlclxufVxuXG4vLyBwYXJzZSBYTUwgcmVzcG9uc2UgZm9yIGxpc3QgcGFydHMgb2YgYW4gaW4gcHJvZ3Jlc3MgbXVsdGlwYXJ0IHVwbG9hZFxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTGlzdFBhcnRzKHhtbDogc3RyaW5nKToge1xuICBpc1RydW5jYXRlZDogYm9vbGVhblxuICBtYXJrZXI6IG51bWJlclxuICBwYXJ0czogVXBsb2FkZWRQYXJ0W11cbn0ge1xuICBsZXQgeG1sb2JqID0gcGFyc2VYbWwoeG1sKVxuICBjb25zdCByZXN1bHQ6IHtcbiAgICBpc1RydW5jYXRlZDogYm9vbGVhblxuICAgIG1hcmtlcjogbnVtYmVyXG4gICAgcGFydHM6IFVwbG9hZGVkUGFydFtdXG4gIH0gPSB7XG4gICAgaXNUcnVuY2F0ZWQ6IGZhbHNlLFxuICAgIHBhcnRzOiBbXSxcbiAgICBtYXJrZXI6IDAsXG4gIH1cbiAgaWYgKCF4bWxvYmouTGlzdFBhcnRzUmVzdWx0KSB7XG4gICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkWE1MRXJyb3IoJ01pc3NpbmcgdGFnOiBcIkxpc3RQYXJ0c1Jlc3VsdFwiJylcbiAgfVxuICB4bWxvYmogPSB4bWxvYmouTGlzdFBhcnRzUmVzdWx0XG4gIGlmICh4bWxvYmouSXNUcnVuY2F0ZWQpIHtcbiAgICByZXN1bHQuaXNUcnVuY2F0ZWQgPSB4bWxvYmouSXNUcnVuY2F0ZWRcbiAgfVxuICBpZiAoeG1sb2JqLk5leHRQYXJ0TnVtYmVyTWFya2VyKSB7XG4gICAgcmVzdWx0Lm1hcmtlciA9IHRvQXJyYXkoeG1sb2JqLk5leHRQYXJ0TnVtYmVyTWFya2VyKVswXSB8fCAnJ1xuICB9XG4gIGlmICh4bWxvYmouUGFydCkge1xuICAgIHRvQXJyYXkoeG1sb2JqLlBhcnQpLmZvckVhY2goKHApID0+IHtcbiAgICAgIGNvbnN0IHBhcnQgPSBwYXJzZUludCh0b0FycmF5KHAuUGFydE51bWJlcilbMF0sIDEwKVxuICAgICAgY29uc3QgbGFzdE1vZGlmaWVkID0gbmV3IERhdGUocC5MYXN0TW9kaWZpZWQpXG4gICAgICBjb25zdCBldGFnID0gcC5FVGFnLnJlcGxhY2UoL15cIi9nLCAnJylcbiAgICAgICAgLnJlcGxhY2UoL1wiJC9nLCAnJylcbiAgICAgICAgLnJlcGxhY2UoL14mcXVvdDsvZywgJycpXG4gICAgICAgIC5yZXBsYWNlKC8mcXVvdDskL2csICcnKVxuICAgICAgICAucmVwbGFjZSgvXiYjMzQ7L2csICcnKVxuICAgICAgICAucmVwbGFjZSgvJiMzNDskL2csICcnKVxuICAgICAgcmVzdWx0LnBhcnRzLnB1c2goeyBwYXJ0LCBsYXN0TW9kaWZpZWQsIGV0YWcsIHNpemU6IHBhcnNlSW50KHAuU2l6ZSwgMTApIH0pXG4gICAgfSlcbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUxpc3RCdWNrZXQoeG1sOiBzdHJpbmcpOiBCdWNrZXRJdGVtRnJvbUxpc3RbXSB7XG4gIGxldCByZXN1bHQ6IEJ1Y2tldEl0ZW1Gcm9tTGlzdFtdID0gW11cbiAgY29uc3QgbGlzdEJ1Y2tldFJlc3VsdFBhcnNlciA9IG5ldyBYTUxQYXJzZXIoe1xuICAgIHBhcnNlVGFnVmFsdWU6IHRydWUsIC8vIEVuYWJsZSBwYXJzaW5nIG9mIHZhbHVlc1xuICAgIG51bWJlclBhcnNlT3B0aW9uczoge1xuICAgICAgbGVhZGluZ1plcm9zOiBmYWxzZSwgLy8gRGlzYWJsZSBudW1iZXIgcGFyc2luZyBmb3IgdmFsdWVzIHdpdGggbGVhZGluZyB6ZXJvc1xuICAgICAgaGV4OiBmYWxzZSwgLy8gRGlzYWJsZSBoZXggbnVtYmVyIHBhcnNpbmcgLSBJbnZhbGlkIGJ1Y2tldCBuYW1lXG4gICAgICBza2lwTGlrZTogL15bMC05XSskLywgLy8gU2tpcCBudW1iZXIgcGFyc2luZyBpZiB0aGUgdmFsdWUgY29uc2lzdHMgZW50aXJlbHkgb2YgZGlnaXRzXG4gICAgfSxcbiAgICB0YWdWYWx1ZVByb2Nlc3NvcjogKHRhZ05hbWUsIHRhZ1ZhbHVlID0gJycpID0+IHtcbiAgICAgIC8vIEVuc3VyZSB0aGF0IHRoZSBOYW1lIHRhZyBpcyBhbHdheXMgdHJlYXRlZCBhcyBhIHN0cmluZ1xuICAgICAgaWYgKHRhZ05hbWUgPT09ICdOYW1lJykge1xuICAgICAgICByZXR1cm4gdGFnVmFsdWUudG9TdHJpbmcoKVxuICAgICAgfVxuICAgICAgcmV0dXJuIHRhZ1ZhbHVlXG4gICAgfSxcbiAgICBpZ25vcmVBdHRyaWJ1dGVzOiBmYWxzZSwgLy8gRW5zdXJlIHRoYXQgYWxsIGF0dHJpYnV0ZXMgYXJlIHBhcnNlZFxuICB9KVxuXG4gIGNvbnN0IHBhcnNlZFhtbFJlcyA9IGxpc3RCdWNrZXRSZXN1bHRQYXJzZXIucGFyc2UoeG1sKVxuXG4gIGlmICghcGFyc2VkWG1sUmVzLkxpc3RBbGxNeUJ1Y2tldHNSZXN1bHQpIHtcbiAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRYTUxFcnJvcignTWlzc2luZyB0YWc6IFwiTGlzdEFsbE15QnVja2V0c1Jlc3VsdFwiJylcbiAgfVxuXG4gIGNvbnN0IHsgTGlzdEFsbE15QnVja2V0c1Jlc3VsdDogeyBCdWNrZXRzID0ge30gfSA9IHt9IH0gPSBwYXJzZWRYbWxSZXNcblxuICBpZiAoQnVja2V0cy5CdWNrZXQpIHtcbiAgICByZXN1bHQgPSB0b0FycmF5KEJ1Y2tldHMuQnVja2V0KS5tYXAoKGJ1Y2tldCA9IHt9KSA9PiB7XG4gICAgICBjb25zdCB7IE5hbWU6IGJ1Y2tldE5hbWUsIENyZWF0aW9uRGF0ZSB9ID0gYnVja2V0XG4gICAgICBjb25zdCBjcmVhdGlvbkRhdGUgPSBuZXcgRGF0ZShDcmVhdGlvbkRhdGUpXG5cbiAgICAgIHJldHVybiB7IG5hbWU6IGJ1Y2tldE5hbWUsIGNyZWF0aW9uRGF0ZSB9XG4gICAgfSlcbiAgfVxuXG4gIHJldHVybiByZXN1bHRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSW5pdGlhdGVNdWx0aXBhcnQoeG1sOiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgeG1sb2JqID0gcGFyc2VYbWwoeG1sKVxuXG4gIGlmICgheG1sb2JqLkluaXRpYXRlTXVsdGlwYXJ0VXBsb2FkUmVzdWx0KSB7XG4gICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkWE1MRXJyb3IoJ01pc3NpbmcgdGFnOiBcIkluaXRpYXRlTXVsdGlwYXJ0VXBsb2FkUmVzdWx0XCInKVxuICB9XG4gIHhtbG9iaiA9IHhtbG9iai5Jbml0aWF0ZU11bHRpcGFydFVwbG9hZFJlc3VsdFxuXG4gIGlmICh4bWxvYmouVXBsb2FkSWQpIHtcbiAgICByZXR1cm4geG1sb2JqLlVwbG9hZElkXG4gIH1cbiAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkWE1MRXJyb3IoJ01pc3NpbmcgdGFnOiBcIlVwbG9hZElkXCInKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VSZXBsaWNhdGlvbkNvbmZpZyh4bWw6IHN0cmluZyk6IFJlcGxpY2F0aW9uQ29uZmlnIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICBjb25zdCB7IFJvbGUsIFJ1bGUgfSA9IHhtbE9iai5SZXBsaWNhdGlvbkNvbmZpZ3VyYXRpb25cbiAgcmV0dXJuIHtcbiAgICBSZXBsaWNhdGlvbkNvbmZpZ3VyYXRpb246IHtcbiAgICAgIHJvbGU6IFJvbGUsXG4gICAgICBydWxlczogdG9BcnJheShSdWxlKSxcbiAgICB9LFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU9iamVjdExlZ2FsSG9sZENvbmZpZyh4bWw6IHN0cmluZykge1xuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXG4gIHJldHVybiB4bWxPYmouTGVnYWxIb2xkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVRhZ2dpbmcoeG1sOiBzdHJpbmcpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICBsZXQgcmVzdWx0ID0gW11cbiAgaWYgKHhtbE9iai5UYWdnaW5nICYmIHhtbE9iai5UYWdnaW5nLlRhZ1NldCAmJiB4bWxPYmouVGFnZ2luZy5UYWdTZXQuVGFnKSB7XG4gICAgY29uc3QgdGFnUmVzdWx0ID0geG1sT2JqLlRhZ2dpbmcuVGFnU2V0LlRhZ1xuICAgIC8vIGlmIGl0IGlzIGEgc2luZ2xlIHRhZyBjb252ZXJ0IGludG8gYW4gYXJyYXkgc28gdGhhdCB0aGUgcmV0dXJuIHZhbHVlIGlzIGFsd2F5cyBhbiBhcnJheS5cbiAgICBpZiAoaXNPYmplY3QodGFnUmVzdWx0KSkge1xuICAgICAgcmVzdWx0LnB1c2godGFnUmVzdWx0KVxuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHQgPSB0YWdSZXN1bHRcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG4vLyBwYXJzZSBYTUwgcmVzcG9uc2Ugd2hlbiBhIG11bHRpcGFydCB1cGxvYWQgaXMgY29tcGxldGVkXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21wbGV0ZU11bHRpcGFydCh4bWw6IHN0cmluZykge1xuICBjb25zdCB4bWxvYmogPSBwYXJzZVhtbCh4bWwpLkNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkUmVzdWx0XG4gIGlmICh4bWxvYmouTG9jYXRpb24pIHtcbiAgICBjb25zdCBsb2NhdGlvbiA9IHRvQXJyYXkoeG1sb2JqLkxvY2F0aW9uKVswXVxuICAgIGNvbnN0IGJ1Y2tldCA9IHRvQXJyYXkoeG1sb2JqLkJ1Y2tldClbMF1cbiAgICBjb25zdCBrZXkgPSB4bWxvYmouS2V5XG4gICAgY29uc3QgZXRhZyA9IHhtbG9iai5FVGFnLnJlcGxhY2UoL15cIi9nLCAnJylcbiAgICAgIC5yZXBsYWNlKC9cIiQvZywgJycpXG4gICAgICAucmVwbGFjZSgvXiZxdW90Oy9nLCAnJylcbiAgICAgIC5yZXBsYWNlKC8mcXVvdDskL2csICcnKVxuICAgICAgLnJlcGxhY2UoL14mIzM0Oy9nLCAnJylcbiAgICAgIC5yZXBsYWNlKC8mIzM0OyQvZywgJycpXG5cbiAgICByZXR1cm4geyBsb2NhdGlvbiwgYnVja2V0LCBrZXksIGV0YWcgfVxuICB9XG4gIC8vIENvbXBsZXRlIE11bHRpcGFydCBjYW4gcmV0dXJuIFhNTCBFcnJvciBhZnRlciBhIDIwMCBPSyByZXNwb25zZVxuICBpZiAoeG1sb2JqLkNvZGUgJiYgeG1sb2JqLk1lc3NhZ2UpIHtcbiAgICBjb25zdCBlcnJDb2RlID0gdG9BcnJheSh4bWxvYmouQ29kZSlbMF1cbiAgICBjb25zdCBlcnJNZXNzYWdlID0gdG9BcnJheSh4bWxvYmouTWVzc2FnZSlbMF1cbiAgICByZXR1cm4geyBlcnJDb2RlLCBlcnJNZXNzYWdlIH1cbiAgfVxufVxuXG50eXBlIFVwbG9hZElEID0gc3RyaW5nXG5cbmV4cG9ydCB0eXBlIExpc3RNdWx0aXBhcnRSZXN1bHQgPSB7XG4gIHVwbG9hZHM6IHtcbiAgICBrZXk6IHN0cmluZ1xuICAgIHVwbG9hZElkOiBVcGxvYWRJRFxuICAgIGluaXRpYXRvcj86IHsgaWQ6IHN0cmluZzsgZGlzcGxheU5hbWU6IHN0cmluZyB9XG4gICAgb3duZXI/OiB7IGlkOiBzdHJpbmc7IGRpc3BsYXlOYW1lOiBzdHJpbmcgfVxuICAgIHN0b3JhZ2VDbGFzczogdW5rbm93blxuICAgIGluaXRpYXRlZDogRGF0ZVxuICB9W11cbiAgcHJlZml4ZXM6IHtcbiAgICBwcmVmaXg6IHN0cmluZ1xuICB9W11cbiAgaXNUcnVuY2F0ZWQ6IGJvb2xlYW5cbiAgbmV4dEtleU1hcmtlcjogc3RyaW5nXG4gIG5leHRVcGxvYWRJZE1hcmtlcjogc3RyaW5nXG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdGluZyBpbi1wcm9ncmVzcyBtdWx0aXBhcnQgdXBsb2Fkc1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTGlzdE11bHRpcGFydCh4bWw6IHN0cmluZyk6IExpc3RNdWx0aXBhcnRSZXN1bHQge1xuICBjb25zdCByZXN1bHQ6IExpc3RNdWx0aXBhcnRSZXN1bHQgPSB7XG4gICAgcHJlZml4ZXM6IFtdLFxuICAgIHVwbG9hZHM6IFtdLFxuICAgIGlzVHJ1bmNhdGVkOiBmYWxzZSxcbiAgICBuZXh0S2V5TWFya2VyOiAnJyxcbiAgICBuZXh0VXBsb2FkSWRNYXJrZXI6ICcnLFxuICB9XG5cbiAgbGV0IHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcblxuICBpZiAoIXhtbG9iai5MaXN0TXVsdGlwYXJ0VXBsb2Fkc1Jlc3VsdCkge1xuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJMaXN0TXVsdGlwYXJ0VXBsb2Fkc1Jlc3VsdFwiJylcbiAgfVxuICB4bWxvYmogPSB4bWxvYmouTGlzdE11bHRpcGFydFVwbG9hZHNSZXN1bHRcbiAgaWYgKHhtbG9iai5Jc1RydW5jYXRlZCkge1xuICAgIHJlc3VsdC5pc1RydW5jYXRlZCA9IHhtbG9iai5Jc1RydW5jYXRlZFxuICB9XG4gIGlmICh4bWxvYmouTmV4dEtleU1hcmtlcikge1xuICAgIHJlc3VsdC5uZXh0S2V5TWFya2VyID0geG1sb2JqLk5leHRLZXlNYXJrZXJcbiAgfVxuICBpZiAoeG1sb2JqLk5leHRVcGxvYWRJZE1hcmtlcikge1xuICAgIHJlc3VsdC5uZXh0VXBsb2FkSWRNYXJrZXIgPSB4bWxvYmoubmV4dFVwbG9hZElkTWFya2VyIHx8ICcnXG4gIH1cblxuICBpZiAoeG1sb2JqLkNvbW1vblByZWZpeGVzKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ29tbW9uUHJlZml4ZXMpLmZvckVhY2goKHByZWZpeCkgPT4ge1xuICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvciBpbmRleCBjaGVja1xuICAgICAgcmVzdWx0LnByZWZpeGVzLnB1c2goeyBwcmVmaXg6IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXk8c3RyaW5nPihwcmVmaXguUHJlZml4KVswXSkgfSlcbiAgICB9KVxuICB9XG5cbiAgaWYgKHhtbG9iai5VcGxvYWQpIHtcbiAgICB0b0FycmF5KHhtbG9iai5VcGxvYWQpLmZvckVhY2goKHVwbG9hZCkgPT4ge1xuICAgICAgY29uc3QgdXBsb2FkSXRlbTogTGlzdE11bHRpcGFydFJlc3VsdFsndXBsb2FkcyddW251bWJlcl0gPSB7XG4gICAgICAgIGtleTogdXBsb2FkLktleSxcbiAgICAgICAgdXBsb2FkSWQ6IHVwbG9hZC5VcGxvYWRJZCxcbiAgICAgICAgc3RvcmFnZUNsYXNzOiB1cGxvYWQuU3RvcmFnZUNsYXNzLFxuICAgICAgICBpbml0aWF0ZWQ6IG5ldyBEYXRlKHVwbG9hZC5Jbml0aWF0ZWQpLFxuICAgICAgfVxuICAgICAgaWYgKHVwbG9hZC5Jbml0aWF0b3IpIHtcbiAgICAgICAgdXBsb2FkSXRlbS5pbml0aWF0b3IgPSB7IGlkOiB1cGxvYWQuSW5pdGlhdG9yLklELCBkaXNwbGF5TmFtZTogdXBsb2FkLkluaXRpYXRvci5EaXNwbGF5TmFtZSB9XG4gICAgICB9XG4gICAgICBpZiAodXBsb2FkLk93bmVyKSB7XG4gICAgICAgIHVwbG9hZEl0ZW0ub3duZXIgPSB7IGlkOiB1cGxvYWQuT3duZXIuSUQsIGRpc3BsYXlOYW1lOiB1cGxvYWQuT3duZXIuRGlzcGxheU5hbWUgfVxuICAgICAgfVxuICAgICAgcmVzdWx0LnVwbG9hZHMucHVzaCh1cGxvYWRJdGVtKVxuICAgIH0pXG4gIH1cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VPYmplY3RMb2NrQ29uZmlnKHhtbDogc3RyaW5nKTogT2JqZWN0TG9ja0luZm8ge1xuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXG4gIGxldCBsb2NrQ29uZmlnUmVzdWx0ID0ge30gYXMgT2JqZWN0TG9ja0luZm9cbiAgaWYgKHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbikge1xuICAgIGxvY2tDb25maWdSZXN1bHQgPSB7XG4gICAgICBvYmplY3RMb2NrRW5hYmxlZDogeG1sT2JqLk9iamVjdExvY2tDb25maWd1cmF0aW9uLk9iamVjdExvY2tFbmFibGVkLFxuICAgIH0gYXMgT2JqZWN0TG9ja0luZm9cbiAgICBsZXQgcmV0ZW50aW9uUmVzcFxuICAgIGlmIChcbiAgICAgIHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbiAmJlxuICAgICAgeG1sT2JqLk9iamVjdExvY2tDb25maWd1cmF0aW9uLlJ1bGUgJiZcbiAgICAgIHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbi5SdWxlLkRlZmF1bHRSZXRlbnRpb25cbiAgICApIHtcbiAgICAgIHJldGVudGlvblJlc3AgPSB4bWxPYmouT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24uUnVsZS5EZWZhdWx0UmV0ZW50aW9uIHx8IHt9XG4gICAgICBsb2NrQ29uZmlnUmVzdWx0Lm1vZGUgPSByZXRlbnRpb25SZXNwLk1vZGVcbiAgICB9XG4gICAgaWYgKHJldGVudGlvblJlc3ApIHtcbiAgICAgIGNvbnN0IGlzVW5pdFllYXJzID0gcmV0ZW50aW9uUmVzcC5ZZWFyc1xuICAgICAgaWYgKGlzVW5pdFllYXJzKSB7XG4gICAgICAgIGxvY2tDb25maWdSZXN1bHQudmFsaWRpdHkgPSBpc1VuaXRZZWFyc1xuICAgICAgICBsb2NrQ29uZmlnUmVzdWx0LnVuaXQgPSBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMuWUVBUlNcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxvY2tDb25maWdSZXN1bHQudmFsaWRpdHkgPSByZXRlbnRpb25SZXNwLkRheXNcbiAgICAgICAgbG9ja0NvbmZpZ1Jlc3VsdC51bml0ID0gUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLkRBWVNcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbG9ja0NvbmZpZ1Jlc3VsdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VCdWNrZXRWZXJzaW9uaW5nQ29uZmlnKHhtbDogc3RyaW5nKSB7XG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcbiAgcmV0dXJuIHhtbE9iai5WZXJzaW9uaW5nQ29uZmlndXJhdGlvblxufVxuXG4vLyBVc2VkIG9ubHkgaW4gc2VsZWN0T2JqZWN0Q29udGVudCBBUEkuXG4vLyBleHRyYWN0SGVhZGVyVHlwZSBleHRyYWN0cyB0aGUgZmlyc3QgaGFsZiBvZiB0aGUgaGVhZGVyIG1lc3NhZ2UsIHRoZSBoZWFkZXIgdHlwZS5cbmZ1bmN0aW9uIGV4dHJhY3RIZWFkZXJUeXBlKHN0cmVhbTogc3RyZWFtLlJlYWRhYmxlKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgaGVhZGVyTmFtZUxlbiA9IEJ1ZmZlci5mcm9tKHN0cmVhbS5yZWFkKDEpKS5yZWFkVUludDgoKVxuICBjb25zdCBoZWFkZXJOYW1lV2l0aFNlcGFyYXRvciA9IEJ1ZmZlci5mcm9tKHN0cmVhbS5yZWFkKGhlYWRlck5hbWVMZW4pKS50b1N0cmluZygpXG4gIGNvbnN0IHNwbGl0QnlTZXBhcmF0b3IgPSAoaGVhZGVyTmFtZVdpdGhTZXBhcmF0b3IgfHwgJycpLnNwbGl0KCc6JylcbiAgcmV0dXJuIHNwbGl0QnlTZXBhcmF0b3IubGVuZ3RoID49IDEgPyBzcGxpdEJ5U2VwYXJhdG9yWzFdIDogJydcbn1cblxuZnVuY3Rpb24gZXh0cmFjdEhlYWRlclZhbHVlKHN0cmVhbTogc3RyZWFtLlJlYWRhYmxlKSB7XG4gIGNvbnN0IGJvZHlMZW4gPSBCdWZmZXIuZnJvbShzdHJlYW0ucmVhZCgyKSkucmVhZFVJbnQxNkJFKClcbiAgcmV0dXJuIEJ1ZmZlci5mcm9tKHN0cmVhbS5yZWFkKGJvZHlMZW4pKS50b1N0cmluZygpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVNlbGVjdE9iamVjdENvbnRlbnRSZXNwb25zZShyZXM6IEJ1ZmZlcikge1xuICBjb25zdCBzZWxlY3RSZXN1bHRzID0gbmV3IFNlbGVjdFJlc3VsdHMoe30pIC8vIHdpbGwgYmUgcmV0dXJuZWRcblxuICBjb25zdCByZXNwb25zZVN0cmVhbSA9IHJlYWRhYmxlU3RyZWFtKHJlcykgLy8gY29udmVydCBieXRlIGFycmF5IHRvIGEgcmVhZGFibGUgcmVzcG9uc2VTdHJlYW1cbiAgLy8gQHRzLWlnbm9yZVxuICB3aGlsZSAocmVzcG9uc2VTdHJlYW0uX3JlYWRhYmxlU3RhdGUubGVuZ3RoKSB7XG4gICAgLy8gVG9wIGxldmVsIHJlc3BvbnNlU3RyZWFtIHJlYWQgdHJhY2tlci5cbiAgICBsZXQgbXNnQ3JjQWNjdW11bGF0b3IgLy8gYWNjdW11bGF0ZSBmcm9tIHN0YXJ0IG9mIHRoZSBtZXNzYWdlIHRpbGwgdGhlIG1lc3NhZ2UgY3JjIHN0YXJ0LlxuXG4gICAgY29uc3QgdG90YWxCeXRlTGVuZ3RoQnVmZmVyID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZCg0KSlcbiAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKHRvdGFsQnl0ZUxlbmd0aEJ1ZmZlcilcblxuICAgIGNvbnN0IGhlYWRlckJ5dGVzQnVmZmVyID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZCg0KSlcbiAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKGhlYWRlckJ5dGVzQnVmZmVyLCBtc2dDcmNBY2N1bXVsYXRvcilcblxuICAgIGNvbnN0IGNhbGN1bGF0ZWRQcmVsdWRlQ3JjID0gbXNnQ3JjQWNjdW11bGF0b3IucmVhZEludDMyQkUoKSAvLyB1c2UgaXQgdG8gY2hlY2sgaWYgYW55IENSQyBtaXNtYXRjaCBpbiBoZWFkZXIgaXRzZWxmLlxuXG4gICAgY29uc3QgcHJlbHVkZUNyY0J1ZmZlciA9IEJ1ZmZlci5mcm9tKHJlc3BvbnNlU3RyZWFtLnJlYWQoNCkpIC8vIHJlYWQgNCBieXRlcyAgICBpLmUgNCs0ID04ICsgNCA9IDEyICggcHJlbHVkZSArIHByZWx1ZGUgY3JjKVxuICAgIG1zZ0NyY0FjY3VtdWxhdG9yID0gY3JjMzIocHJlbHVkZUNyY0J1ZmZlciwgbXNnQ3JjQWNjdW11bGF0b3IpXG5cbiAgICBjb25zdCB0b3RhbE1zZ0xlbmd0aCA9IHRvdGFsQnl0ZUxlbmd0aEJ1ZmZlci5yZWFkSW50MzJCRSgpXG4gICAgY29uc3QgaGVhZGVyTGVuZ3RoID0gaGVhZGVyQnl0ZXNCdWZmZXIucmVhZEludDMyQkUoKVxuICAgIGNvbnN0IHByZWx1ZGVDcmNCeXRlVmFsdWUgPSBwcmVsdWRlQ3JjQnVmZmVyLnJlYWRJbnQzMkJFKClcblxuICAgIGlmIChwcmVsdWRlQ3JjQnl0ZVZhbHVlICE9PSBjYWxjdWxhdGVkUHJlbHVkZUNyYykge1xuICAgICAgLy8gSGFuZGxlIEhlYWRlciBDUkMgbWlzbWF0Y2ggRXJyb3JcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYEhlYWRlciBDaGVja3N1bSBNaXNtYXRjaCwgUHJlbHVkZSBDUkMgb2YgJHtwcmVsdWRlQ3JjQnl0ZVZhbHVlfSBkb2VzIG5vdCBlcXVhbCBleHBlY3RlZCBDUkMgb2YgJHtjYWxjdWxhdGVkUHJlbHVkZUNyY31gLFxuICAgICAgKVxuICAgIH1cblxuICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge31cbiAgICBpZiAoaGVhZGVyTGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgaGVhZGVyQnl0ZXMgPSBCdWZmZXIuZnJvbShyZXNwb25zZVN0cmVhbS5yZWFkKGhlYWRlckxlbmd0aCkpXG4gICAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKGhlYWRlckJ5dGVzLCBtc2dDcmNBY2N1bXVsYXRvcilcbiAgICAgIGNvbnN0IGhlYWRlclJlYWRlclN0cmVhbSA9IHJlYWRhYmxlU3RyZWFtKGhlYWRlckJ5dGVzKVxuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgd2hpbGUgKGhlYWRlclJlYWRlclN0cmVhbS5fcmVhZGFibGVTdGF0ZS5sZW5ndGgpIHtcbiAgICAgICAgY29uc3QgaGVhZGVyVHlwZU5hbWUgPSBleHRyYWN0SGVhZGVyVHlwZShoZWFkZXJSZWFkZXJTdHJlYW0pXG4gICAgICAgIGhlYWRlclJlYWRlclN0cmVhbS5yZWFkKDEpIC8vIGp1c3QgcmVhZCBhbmQgaWdub3JlIGl0LlxuICAgICAgICBpZiAoaGVhZGVyVHlwZU5hbWUpIHtcbiAgICAgICAgICBoZWFkZXJzW2hlYWRlclR5cGVOYW1lXSA9IGV4dHJhY3RIZWFkZXJWYWx1ZShoZWFkZXJSZWFkZXJTdHJlYW0pXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgcGF5bG9hZFN0cmVhbVxuICAgIGNvbnN0IHBheUxvYWRMZW5ndGggPSB0b3RhbE1zZ0xlbmd0aCAtIGhlYWRlckxlbmd0aCAtIDE2XG4gICAgaWYgKHBheUxvYWRMZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBwYXlMb2FkQnVmZmVyID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZChwYXlMb2FkTGVuZ3RoKSlcbiAgICAgIG1zZ0NyY0FjY3VtdWxhdG9yID0gY3JjMzIocGF5TG9hZEJ1ZmZlciwgbXNnQ3JjQWNjdW11bGF0b3IpXG4gICAgICAvLyByZWFkIHRoZSBjaGVja3N1bSBlYXJseSBhbmQgZGV0ZWN0IGFueSBtaXNtYXRjaCBzbyB3ZSBjYW4gYXZvaWQgdW5uZWNlc3NhcnkgZnVydGhlciBwcm9jZXNzaW5nLlxuICAgICAgY29uc3QgbWVzc2FnZUNyY0J5dGVWYWx1ZSA9IEJ1ZmZlci5mcm9tKHJlc3BvbnNlU3RyZWFtLnJlYWQoNCkpLnJlYWRJbnQzMkJFKClcbiAgICAgIGNvbnN0IGNhbGN1bGF0ZWRDcmMgPSBtc2dDcmNBY2N1bXVsYXRvci5yZWFkSW50MzJCRSgpXG4gICAgICAvLyBIYW5kbGUgbWVzc2FnZSBDUkMgRXJyb3JcbiAgICAgIGlmIChtZXNzYWdlQ3JjQnl0ZVZhbHVlICE9PSBjYWxjdWxhdGVkQ3JjKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBgTWVzc2FnZSBDaGVja3N1bSBNaXNtYXRjaCwgTWVzc2FnZSBDUkMgb2YgJHttZXNzYWdlQ3JjQnl0ZVZhbHVlfSBkb2VzIG5vdCBlcXVhbCBleHBlY3RlZCBDUkMgb2YgJHtjYWxjdWxhdGVkQ3JjfWAsXG4gICAgICAgIClcbiAgICAgIH1cbiAgICAgIHBheWxvYWRTdHJlYW0gPSByZWFkYWJsZVN0cmVhbShwYXlMb2FkQnVmZmVyKVxuICAgIH1cbiAgICBjb25zdCBtZXNzYWdlVHlwZSA9IGhlYWRlcnNbJ21lc3NhZ2UtdHlwZSddXG5cbiAgICBzd2l0Y2ggKG1lc3NhZ2VUeXBlKSB7XG4gICAgICBjYXNlICdlcnJvcic6IHtcbiAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gaGVhZGVyc1snZXJyb3ItY29kZSddICsgJzpcIicgKyBoZWFkZXJzWydlcnJvci1tZXNzYWdlJ10gKyAnXCInXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpXG4gICAgICB9XG4gICAgICBjYXNlICdldmVudCc6IHtcbiAgICAgICAgY29uc3QgY29udGVudFR5cGUgPSBoZWFkZXJzWydjb250ZW50LXR5cGUnXVxuICAgICAgICBjb25zdCBldmVudFR5cGUgPSBoZWFkZXJzWydldmVudC10eXBlJ11cblxuICAgICAgICBzd2l0Y2ggKGV2ZW50VHlwZSkge1xuICAgICAgICAgIGNhc2UgJ0VuZCc6IHtcbiAgICAgICAgICAgIHNlbGVjdFJlc3VsdHMuc2V0UmVzcG9uc2UocmVzKVxuICAgICAgICAgICAgcmV0dXJuIHNlbGVjdFJlc3VsdHNcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjYXNlICdSZWNvcmRzJzoge1xuICAgICAgICAgICAgY29uc3QgcmVhZERhdGEgPSBwYXlsb2FkU3RyZWFtPy5yZWFkKHBheUxvYWRMZW5ndGgpXG4gICAgICAgICAgICBzZWxlY3RSZXN1bHRzLnNldFJlY29yZHMocmVhZERhdGEpXG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNhc2UgJ1Byb2dyZXNzJzpcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3dpdGNoIChjb250ZW50VHlwZSkge1xuICAgICAgICAgICAgICAgIGNhc2UgJ3RleHQveG1sJzoge1xuICAgICAgICAgICAgICAgICAgY29uc3QgcHJvZ3Jlc3NEYXRhID0gcGF5bG9hZFN0cmVhbT8ucmVhZChwYXlMb2FkTGVuZ3RoKVxuICAgICAgICAgICAgICAgICAgc2VsZWN0UmVzdWx0cy5zZXRQcm9ncmVzcyhwcm9ncmVzc0RhdGEudG9TdHJpbmcoKSlcbiAgICAgICAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6IHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGBVbmV4cGVjdGVkIGNvbnRlbnQtdHlwZSAke2NvbnRlbnRUeXBlfSBzZW50IGZvciBldmVudC10eXBlIFByb2dyZXNzYFxuICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGVycm9yTWVzc2FnZSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgY2FzZSAnU3RhdHMnOlxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzd2l0Y2ggKGNvbnRlbnRUeXBlKSB7XG4gICAgICAgICAgICAgICAgY2FzZSAndGV4dC94bWwnOiB7XG4gICAgICAgICAgICAgICAgICBjb25zdCBzdGF0c0RhdGEgPSBwYXlsb2FkU3RyZWFtPy5yZWFkKHBheUxvYWRMZW5ndGgpXG4gICAgICAgICAgICAgICAgICBzZWxlY3RSZXN1bHRzLnNldFN0YXRzKHN0YXRzRGF0YS50b1N0cmluZygpKVxuICAgICAgICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZGVmYXVsdDoge1xuICAgICAgICAgICAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gYFVuZXhwZWN0ZWQgY29udGVudC10eXBlICR7Y29udGVudFR5cGV9IHNlbnQgZm9yIGV2ZW50LXR5cGUgU3RhdHNgXG4gICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICBkZWZhdWx0OiB7XG4gICAgICAgICAgICAvLyBDb250aW51YXRpb24gbWVzc2FnZTogTm90IHN1cmUgaWYgaXQgaXMgc3VwcG9ydGVkLiBkaWQgbm90IGZpbmQgYSByZWZlcmVuY2Ugb3IgYW55IG1lc3NhZ2UgaW4gcmVzcG9uc2UuXG4gICAgICAgICAgICAvLyBJdCBkb2VzIG5vdCBoYXZlIGEgcGF5bG9hZC5cbiAgICAgICAgICAgIGNvbnN0IHdhcm5pbmdNZXNzYWdlID0gYFVuIGltcGxlbWVudGVkIGV2ZW50IGRldGVjdGVkICAke21lc3NhZ2VUeXBlfS5gXG4gICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgICAgICAgICAgY29uc29sZS53YXJuKHdhcm5pbmdNZXNzYWdlKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaWZlY3ljbGVDb25maWcoeG1sOiBzdHJpbmcpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICByZXR1cm4geG1sT2JqLkxpZmVjeWNsZUNvbmZpZ3VyYXRpb25cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQnVja2V0RW5jcnlwdGlvbkNvbmZpZyh4bWw6IHN0cmluZykge1xuICByZXR1cm4gcGFyc2VYbWwoeG1sKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VPYmplY3RSZXRlbnRpb25Db25maWcoeG1sOiBzdHJpbmcpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICBjb25zdCByZXRlbnRpb25Db25maWcgPSB4bWxPYmouUmV0ZW50aW9uXG4gIHJldHVybiB7XG4gICAgbW9kZTogcmV0ZW50aW9uQ29uZmlnLk1vZGUsXG4gICAgcmV0YWluVW50aWxEYXRlOiByZXRlbnRpb25Db25maWcuUmV0YWluVW50aWxEYXRlLFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW1vdmVPYmplY3RzUGFyc2VyKHhtbDogc3RyaW5nKSB7XG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcbiAgaWYgKHhtbE9iai5EZWxldGVSZXN1bHQgJiYgeG1sT2JqLkRlbGV0ZVJlc3VsdC5FcnJvcikge1xuICAgIC8vIHJldHVybiBlcnJvcnMgYXMgYXJyYXkgYWx3YXlzLiBhcyB0aGUgcmVzcG9uc2UgaXMgb2JqZWN0IGluIGNhc2Ugb2Ygc2luZ2xlIG9iamVjdCBwYXNzZWQgaW4gcmVtb3ZlT2JqZWN0c1xuICAgIHJldHVybiB0b0FycmF5KHhtbE9iai5EZWxldGVSZXN1bHQuRXJyb3IpXG4gIH1cbiAgcmV0dXJuIFtdXG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgY29weSBvYmplY3RcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvcHlPYmplY3QoeG1sOiBzdHJpbmcpOiBDb3B5T2JqZWN0UmVzdWx0VjEge1xuICBjb25zdCByZXN1bHQ6IENvcHlPYmplY3RSZXN1bHRWMSA9IHtcbiAgICBldGFnOiAnJyxcbiAgICBsYXN0TW9kaWZpZWQ6ICcnLFxuICB9XG5cbiAgbGV0IHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcbiAgaWYgKCF4bWxvYmouQ29weU9iamVjdFJlc3VsdCkge1xuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJDb3B5T2JqZWN0UmVzdWx0XCInKVxuICB9XG4gIHhtbG9iaiA9IHhtbG9iai5Db3B5T2JqZWN0UmVzdWx0XG4gIGlmICh4bWxvYmouRVRhZykge1xuICAgIHJlc3VsdC5ldGFnID0geG1sb2JqLkVUYWcucmVwbGFjZSgvXlwiL2csICcnKVxuICAgICAgLnJlcGxhY2UoL1wiJC9nLCAnJylcbiAgICAgIC5yZXBsYWNlKC9eJnF1b3Q7L2csICcnKVxuICAgICAgLnJlcGxhY2UoLyZxdW90OyQvZywgJycpXG4gICAgICAucmVwbGFjZSgvXiYjMzQ7L2csICcnKVxuICAgICAgLnJlcGxhY2UoLyYjMzQ7JC9nLCAnJylcbiAgfVxuICBpZiAoeG1sb2JqLkxhc3RNb2RpZmllZCkge1xuICAgIHJlc3VsdC5sYXN0TW9kaWZpZWQgPSBuZXcgRGF0ZSh4bWxvYmouTGFzdE1vZGlmaWVkKVxuICB9XG5cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG5jb25zdCBmb3JtYXRPYmpJbmZvID0gKGNvbnRlbnQ6IE9iamVjdFJvd0VudHJ5LCBvcHRzOiB7IElzRGVsZXRlTWFya2VyPzogYm9vbGVhbiB9ID0ge30pID0+IHtcbiAgY29uc3QgeyBLZXksIExhc3RNb2RpZmllZCwgRVRhZywgU2l6ZSwgVmVyc2lvbklkLCBJc0xhdGVzdCB9ID0gY29udGVudFxuXG4gIGlmICghaXNPYmplY3Qob3B0cykpIHtcbiAgICBvcHRzID0ge31cbiAgfVxuXG4gIGNvbnN0IG5hbWUgPSBzYW5pdGl6ZU9iamVjdEtleSh0b0FycmF5KEtleSlbMF0gfHwgJycpXG4gIGNvbnN0IGxhc3RNb2RpZmllZCA9IExhc3RNb2RpZmllZCA/IG5ldyBEYXRlKHRvQXJyYXkoTGFzdE1vZGlmaWVkKVswXSB8fCAnJykgOiB1bmRlZmluZWRcbiAgY29uc3QgZXRhZyA9IHNhbml0aXplRVRhZyh0b0FycmF5KEVUYWcpWzBdIHx8ICcnKVxuICBjb25zdCBzaXplID0gc2FuaXRpemVTaXplKFNpemUgfHwgJycpXG5cbiAgcmV0dXJuIHtcbiAgICBuYW1lLFxuICAgIGxhc3RNb2RpZmllZCxcbiAgICBldGFnLFxuICAgIHNpemUsXG4gICAgdmVyc2lvbklkOiBWZXJzaW9uSWQsXG4gICAgaXNMYXRlc3Q6IElzTGF0ZXN0LFxuICAgIGlzRGVsZXRlTWFya2VyOiBvcHRzLklzRGVsZXRlTWFya2VyID8gb3B0cy5Jc0RlbGV0ZU1hcmtlciA6IGZhbHNlLFxuICB9XG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdCBvYmplY3RzIGluIGEgYnVja2V0XG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaXN0T2JqZWN0cyh4bWw6IHN0cmluZykge1xuICBjb25zdCByZXN1bHQ6IHsgb2JqZWN0czogT2JqZWN0SW5mb1tdOyBpc1RydW5jYXRlZD86IGJvb2xlYW47IG5leHRNYXJrZXI/OiBzdHJpbmc7IHZlcnNpb25JZE1hcmtlcj86IHN0cmluZyB9ID0ge1xuICAgIG9iamVjdHM6IFtdLFxuICAgIGlzVHJ1bmNhdGVkOiBmYWxzZSxcbiAgICBuZXh0TWFya2VyOiB1bmRlZmluZWQsXG4gICAgdmVyc2lvbklkTWFya2VyOiB1bmRlZmluZWQsXG4gIH1cbiAgbGV0IGlzVHJ1bmNhdGVkID0gZmFsc2VcbiAgbGV0IG5leHRNYXJrZXIsIG5leHRWZXJzaW9uS2V5TWFya2VyXG4gIGNvbnN0IHhtbG9iaiA9IGZ4cFdpdGhvdXROdW1QYXJzZXIucGFyc2UoeG1sKVxuXG4gIGNvbnN0IHBhcnNlQ29tbW9uUHJlZml4ZXNFbnRpdHkgPSAoY29tbW9uUHJlZml4RW50cnk6IENvbW1vblByZWZpeFtdKSA9PiB7XG4gICAgaWYgKGNvbW1vblByZWZpeEVudHJ5KSB7XG4gICAgICB0b0FycmF5KGNvbW1vblByZWZpeEVudHJ5KS5mb3JFYWNoKChjb21tb25QcmVmaXgpID0+IHtcbiAgICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IHByZWZpeDogc2FuaXRpemVPYmplY3RLZXkodG9BcnJheShjb21tb25QcmVmaXguUHJlZml4KVswXSB8fCAnJyksIHNpemU6IDAgfSlcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgY29uc3QgbGlzdEJ1Y2tldFJlc3VsdDogTGlzdEJ1Y2tldFJlc3VsdFYxID0geG1sb2JqLkxpc3RCdWNrZXRSZXN1bHRcbiAgY29uc3QgbGlzdFZlcnNpb25zUmVzdWx0OiBMaXN0QnVja2V0UmVzdWx0VjEgPSB4bWxvYmouTGlzdFZlcnNpb25zUmVzdWx0XG5cbiAgaWYgKGxpc3RCdWNrZXRSZXN1bHQpIHtcbiAgICBpZiAobGlzdEJ1Y2tldFJlc3VsdC5Jc1RydW5jYXRlZCkge1xuICAgICAgaXNUcnVuY2F0ZWQgPSBsaXN0QnVja2V0UmVzdWx0LklzVHJ1bmNhdGVkXG4gICAgfVxuICAgIGlmIChsaXN0QnVja2V0UmVzdWx0LkNvbnRlbnRzKSB7XG4gICAgICB0b0FycmF5KGxpc3RCdWNrZXRSZXN1bHQuQ29udGVudHMpLmZvckVhY2goKGNvbnRlbnQpID0+IHtcbiAgICAgICAgY29uc3QgbmFtZSA9IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXkoY29udGVudC5LZXkpWzBdIHx8ICcnKVxuICAgICAgICBjb25zdCBsYXN0TW9kaWZpZWQgPSBuZXcgRGF0ZSh0b0FycmF5KGNvbnRlbnQuTGFzdE1vZGlmaWVkKVswXSB8fCAnJylcbiAgICAgICAgY29uc3QgZXRhZyA9IHNhbml0aXplRVRhZyh0b0FycmF5KGNvbnRlbnQuRVRhZylbMF0gfHwgJycpXG4gICAgICAgIGNvbnN0IHNpemUgPSBzYW5pdGl6ZVNpemUoY29udGVudC5TaXplIHx8ICcnKVxuICAgICAgICByZXN1bHQub2JqZWN0cy5wdXNoKHsgbmFtZSwgbGFzdE1vZGlmaWVkLCBldGFnLCBzaXplIH0pXG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmIChsaXN0QnVja2V0UmVzdWx0Lk1hcmtlcikge1xuICAgICAgbmV4dE1hcmtlciA9IGxpc3RCdWNrZXRSZXN1bHQuTWFya2VyXG4gICAgfSBlbHNlIGlmIChpc1RydW5jYXRlZCAmJiByZXN1bHQub2JqZWN0cy5sZW5ndGggPiAwKSB7XG4gICAgICBuZXh0TWFya2VyID0gcmVzdWx0Lm9iamVjdHNbcmVzdWx0Lm9iamVjdHMubGVuZ3RoIC0gMV0/Lm5hbWVcbiAgICB9XG4gICAgaWYgKGxpc3RCdWNrZXRSZXN1bHQuQ29tbW9uUHJlZml4ZXMpIHtcbiAgICAgIHBhcnNlQ29tbW9uUHJlZml4ZXNFbnRpdHkobGlzdEJ1Y2tldFJlc3VsdC5Db21tb25QcmVmaXhlcylcbiAgICB9XG4gIH1cblxuICBpZiAobGlzdFZlcnNpb25zUmVzdWx0KSB7XG4gICAgaWYgKGxpc3RWZXJzaW9uc1Jlc3VsdC5Jc1RydW5jYXRlZCkge1xuICAgICAgaXNUcnVuY2F0ZWQgPSBsaXN0VmVyc2lvbnNSZXN1bHQuSXNUcnVuY2F0ZWRcbiAgICB9XG5cbiAgICBpZiAobGlzdFZlcnNpb25zUmVzdWx0LlZlcnNpb24pIHtcbiAgICAgIHRvQXJyYXkobGlzdFZlcnNpb25zUmVzdWx0LlZlcnNpb24pLmZvckVhY2goKGNvbnRlbnQpID0+IHtcbiAgICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaChmb3JtYXRPYmpJbmZvKGNvbnRlbnQpKVxuICAgICAgfSlcbiAgICB9XG4gICAgaWYgKGxpc3RWZXJzaW9uc1Jlc3VsdC5EZWxldGVNYXJrZXIpIHtcbiAgICAgIHRvQXJyYXkobGlzdFZlcnNpb25zUmVzdWx0LkRlbGV0ZU1hcmtlcikuZm9yRWFjaCgoY29udGVudCkgPT4ge1xuICAgICAgICByZXN1bHQub2JqZWN0cy5wdXNoKGZvcm1hdE9iakluZm8oY29udGVudCwgeyBJc0RlbGV0ZU1hcmtlcjogdHJ1ZSB9KSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKGxpc3RWZXJzaW9uc1Jlc3VsdC5OZXh0S2V5TWFya2VyKSB7XG4gICAgICBuZXh0VmVyc2lvbktleU1hcmtlciA9IGxpc3RWZXJzaW9uc1Jlc3VsdC5OZXh0S2V5TWFya2VyXG4gICAgfVxuICAgIGlmIChsaXN0VmVyc2lvbnNSZXN1bHQuTmV4dFZlcnNpb25JZE1hcmtlcikge1xuICAgICAgcmVzdWx0LnZlcnNpb25JZE1hcmtlciA9IGxpc3RWZXJzaW9uc1Jlc3VsdC5OZXh0VmVyc2lvbklkTWFya2VyXG4gICAgfVxuICAgIGlmIChsaXN0VmVyc2lvbnNSZXN1bHQuQ29tbW9uUHJlZml4ZXMpIHtcbiAgICAgIHBhcnNlQ29tbW9uUHJlZml4ZXNFbnRpdHkobGlzdFZlcnNpb25zUmVzdWx0LkNvbW1vblByZWZpeGVzKVxuICAgIH1cbiAgfVxuXG4gIHJlc3VsdC5pc1RydW5jYXRlZCA9IGlzVHJ1bmNhdGVkXG4gIGlmIChpc1RydW5jYXRlZCkge1xuICAgIHJlc3VsdC5uZXh0TWFya2VyID0gbmV4dFZlcnNpb25LZXlNYXJrZXIgfHwgbmV4dE1hcmtlclxuICB9XG4gIHJldHVybiByZXN1bHRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHVwbG9hZFBhcnRQYXJzZXIoeG1sOiBzdHJpbmcpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICBjb25zdCByZXNwRWwgPSB4bWxPYmouQ29weVBhcnRSZXN1bHRcbiAgcmV0dXJuIHJlc3BFbFxufVxuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFHQSxJQUFBQSxVQUFBLEdBQUFDLE9BQUE7QUFDQSxJQUFBQyxjQUFBLEdBQUFELE9BQUE7QUFFQSxJQUFBRSxNQUFBLEdBQUFDLHVCQUFBLENBQUFILE9BQUE7QUFDQSxJQUFBSSxRQUFBLEdBQUFKLE9BQUE7QUFDQSxJQUFBSyxPQUFBLEdBQUFMLE9BQUE7QUFDQSxJQUFBTSxTQUFBLEdBQUFOLE9BQUE7QUFhQSxJQUFBTyxLQUFBLEdBQUFQLE9BQUE7QUFBb0QsU0FBQVEseUJBQUFDLFdBQUEsZUFBQUMsT0FBQSxrQ0FBQUMsaUJBQUEsT0FBQUQsT0FBQSxRQUFBRSxnQkFBQSxPQUFBRixPQUFBLFlBQUFGLHdCQUFBLFlBQUFBLENBQUFDLFdBQUEsV0FBQUEsV0FBQSxHQUFBRyxnQkFBQSxHQUFBRCxpQkFBQSxLQUFBRixXQUFBO0FBQUEsU0FBQU4sd0JBQUFVLEdBQUEsRUFBQUosV0FBQSxTQUFBQSxXQUFBLElBQUFJLEdBQUEsSUFBQUEsR0FBQSxDQUFBQyxVQUFBLFdBQUFELEdBQUEsUUFBQUEsR0FBQSxvQkFBQUEsR0FBQSx3QkFBQUEsR0FBQSw0QkFBQUUsT0FBQSxFQUFBRixHQUFBLFVBQUFHLEtBQUEsR0FBQVIsd0JBQUEsQ0FBQUMsV0FBQSxPQUFBTyxLQUFBLElBQUFBLEtBQUEsQ0FBQUMsR0FBQSxDQUFBSixHQUFBLFlBQUFHLEtBQUEsQ0FBQUUsR0FBQSxDQUFBTCxHQUFBLFNBQUFNLE1BQUEsV0FBQUMscUJBQUEsR0FBQUMsTUFBQSxDQUFBQyxjQUFBLElBQUFELE1BQUEsQ0FBQUUsd0JBQUEsV0FBQUMsR0FBQSxJQUFBWCxHQUFBLFFBQUFXLEdBQUEs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