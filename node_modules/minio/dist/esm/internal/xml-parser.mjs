import crc32 from 'buffer-crc32';
import { XMLParser } from 'fast-xml-parser';
import * as errors from "../errors.mjs";
import { SelectResults } from "../helpers.mjs";
import { isObject, parseXml, readableStream, sanitizeETag, sanitizeObjectKey, sanitizeSize, toArray } from "./helper.mjs";
import { readAsString } from "./response.mjs";
import { RETENTION_VALIDITY_UNITS } from "./type.mjs";

// parse XML response for bucket region
export function parseBucketRegion(xml) {
  // return region information
  return parseXml(xml).LocationConstraint;
}
const fxp = new XMLParser();
const fxpWithoutNumParser = new XMLParser({
  // @ts-ignore
  numberParseOptions: {
    skipLike: /./
  }
});

// Parse XML and return information as Javascript types
// parse error XML response
export function parseError(xml, headerInfo) {
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
export async function parseResponseError(response) {
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
  const xmlString = await readAsString(response);
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
export function parseListObjectsV2WithMetadata(xml) {
  const result = {
    objects: [],
    isTruncated: false,
    nextContinuationToken: ''
  };
  let xmlobj = parseXml(xml);
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
    toArray(xmlobj.Contents).forEach(content => {
      const name = sanitizeObjectKey(content.Key);
      const lastModified = new Date(content.LastModified);
      const etag = sanitizeETag(content.ETag);
      const size = content.Size;
      let tags = {};
      if (content.UserTags != null) {
        toArray(content.UserTags.split('&')).forEach(tag => {
          const [key, value] = tag.split('=');
          tags[key] = value;
        });
      } else {
        tags = {};
      }
      let metadata;
      if (content.UserMetadata != null) {
        metadata = toArray(content.UserMetadata)[0];
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
    toArray(xmlobj.CommonPrefixes).forEach(commonPrefix => {
      result.objects.push({
        prefix: sanitizeObjectKey(toArray(commonPrefix.Prefix)[0]),
        size: 0
      });
    });
  }
  return result;
}
// parse XML response for list parts of an in progress multipart upload
export function parseListParts(xml) {
  let xmlobj = parseXml(xml);
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
    result.marker = toArray(xmlobj.NextPartNumberMarker)[0] || '';
  }
  if (xmlobj.Part) {
    toArray(xmlobj.Part).forEach(p => {
      const part = parseInt(toArray(p.PartNumber)[0], 10);
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
export function parseListBucket(xml) {
  let result = [];
  const listBucketResultParser = new XMLParser({
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
    result = toArray(Buckets.Bucket).map((bucket = {}) => {
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
export function parseInitiateMultipart(xml) {
  let xmlobj = parseXml(xml);
  if (!xmlobj.InitiateMultipartUploadResult) {
    throw new errors.InvalidXMLError('Missing tag: "InitiateMultipartUploadResult"');
  }
  xmlobj = xmlobj.InitiateMultipartUploadResult;
  if (xmlobj.UploadId) {
    return xmlobj.UploadId;
  }
  throw new errors.InvalidXMLError('Missing tag: "UploadId"');
}
export function parseReplicationConfig(xml) {
  const xmlObj = parseXml(xml);
  const {
    Role,
    Rule
  } = xmlObj.ReplicationConfiguration;
  return {
    ReplicationConfiguration: {
      role: Role,
      rules: toArray(Rule)
    }
  };
}
export function parseObjectLegalHoldConfig(xml) {
  const xmlObj = parseXml(xml);
  return xmlObj.LegalHold;
}
export function parseTagging(xml) {
  const xmlObj = parseXml(xml);
  let result = [];
  if (xmlObj.Tagging && xmlObj.Tagging.TagSet && xmlObj.Tagging.TagSet.Tag) {
    const tagResult = xmlObj.Tagging.TagSet.Tag;
    // if it is a single tag convert into an array so that the return value is always an array.
    if (isObject(tagResult)) {
      result.push(tagResult);
    } else {
      result = tagResult;
    }
  }
  return result;
}

// parse XML response when a multipart upload is completed
export function parseCompleteMultipart(xml) {
  const xmlobj = parseXml(xml).CompleteMultipartUploadResult;
  if (xmlobj.Location) {
    const location = toArray(xmlobj.Location)[0];
    const bucket = toArray(xmlobj.Bucket)[0];
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
    const errCode = toArray(xmlobj.Code)[0];
    const errMessage = toArray(xmlobj.Message)[0];
    return {
      errCode,
      errMessage
    };
  }
}
// parse XML response for listing in-progress multipart uploads
export function parseListMultipart(xml) {
  const result = {
    prefixes: [],
    uploads: [],
    isTruncated: false,
    nextKeyMarker: '',
    nextUploadIdMarker: ''
  };
  let xmlobj = parseXml(xml);
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
    toArray(xmlobj.CommonPrefixes).forEach(prefix => {
      // @ts-expect-error index check
      result.prefixes.push({
        prefix: sanitizeObjectKey(toArray(prefix.Prefix)[0])
      });
    });
  }
  if (xmlobj.Upload) {
    toArray(xmlobj.Upload).forEach(upload => {
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
export function parseObjectLockConfig(xml) {
  const xmlObj = parseXml(xml);
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
        lockConfigResult.unit = RETENTION_VALIDITY_UNITS.YEARS;
      } else {
        lockConfigResult.validity = retentionResp.Days;
        lockConfigResult.unit = RETENTION_VALIDITY_UNITS.DAYS;
      }
    }
  }
  return lockConfigResult;
}
export function parseBucketVersioningConfig(xml) {
  const xmlObj = parseXml(xml);
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
export function parseSelectObjectContentResponse(res) {
  const selectResults = new SelectResults({}); // will be returned

  const responseStream = readableStream(res); // convert byte array to a readable responseStream
  // @ts-ignore
  while (responseStream._readableState.length) {
    // Top level responseStream read tracker.
    let msgCrcAccumulator; // accumulate from start of the message till the message crc start.

    const totalByteLengthBuffer = Buffer.from(responseStream.read(4));
    msgCrcAccumulator = crc32(totalByteLengthBuffer);
    const headerBytesBuffer = Buffer.from(responseStream.read(4));
    msgCrcAccumulator = crc32(headerBytesBuffer, msgCrcAccumulator);
    const calculatedPreludeCrc = msgCrcAccumulator.readInt32BE(); // use it to check if any CRC mismatch in header itself.

    const preludeCrcBuffer = Buffer.from(responseStream.read(4)); // read 4 bytes    i.e 4+4 =8 + 4 = 12 ( prelude + prelude crc)
    msgCrcAccumulator = crc32(preludeCrcBuffer, msgCrcAccumulator);
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
      msgCrcAccumulator = crc32(headerBytes, msgCrcAccumulator);
      const headerReaderStream = readableStream(headerBytes);
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
      msgCrcAccumulator = crc32(payLoadBuffer, msgCrcAccumulator);
      // read the checksum early and detect any mismatch so we can avoid unnecessary further processing.
      const messageCrcByteValue = Buffer.from(responseStream.read(4)).readInt32BE();
      const calculatedCrc = msgCrcAccumulator.readInt32BE();
      // Handle message CRC Error
      if (messageCrcByteValue !== calculatedCrc) {
        throw new Error(`Message Checksum Mismatch, Message CRC of ${messageCrcByteValue} does not equal expected CRC of ${calculatedCrc}`);
      }
      payloadStream = readableStream(payLoadBuffer);
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
export function parseLifecycleConfig(xml) {
  const xmlObj = parseXml(xml);
  return xmlObj.LifecycleConfiguration;
}
export function parseBucketEncryptionConfig(xml) {
  return parseXml(xml);
}
export function parseObjectRetentionConfig(xml) {
  const xmlObj = parseXml(xml);
  const retentionConfig = xmlObj.Retention;
  return {
    mode: retentionConfig.Mode,
    retainUntilDate: retentionConfig.RetainUntilDate
  };
}
export function removeObjectsParser(xml) {
  const xmlObj = parseXml(xml);
  if (xmlObj.DeleteResult && xmlObj.DeleteResult.Error) {
    // return errors as array always. as the response is object in case of single object passed in removeObjects
    return toArray(xmlObj.DeleteResult.Error);
  }
  return [];
}

// parse XML response for copy object
export function parseCopyObject(xml) {
  const result = {
    etag: '',
    lastModified: ''
  };
  let xmlobj = parseXml(xml);
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
  if (!isObject(opts)) {
    opts = {};
  }
  const name = sanitizeObjectKey(toArray(Key)[0] || '');
  const lastModified = LastModified ? new Date(toArray(LastModified)[0] || '') : undefined;
  const etag = sanitizeETag(toArray(ETag)[0] || '');
  const size = sanitizeSize(Size || '');
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
export function parseListObjects(xml) {
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
      toArray(commonPrefixEntry).forEach(commonPrefix => {
        result.objects.push({
          prefix: sanitizeObjectKey(toArray(commonPrefix.Prefix)[0] || ''),
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
      toArray(listBucketResult.Contents).forEach(content => {
        const name = sanitizeObjectKey(toArray(content.Key)[0] || '');
        const lastModified = new Date(toArray(content.LastModified)[0] || '');
        const etag = sanitizeETag(toArray(content.ETag)[0] || '');
        const size = sanitizeSize(content.Size || '');
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
      toArray(listVersionsResult.Version).forEach(content => {
        result.objects.push(formatObjInfo(content));
      });
    }
    if (listVersionsResult.DeleteMarker) {
      toArray(listVersionsResult.DeleteMarker).forEach(content => {
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
export function uploadPartParser(xml) {
  const xmlObj = parseXml(xml);
  const respEl = xmlObj.CopyPartResult;
  return respEl;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcmMzMiIsIlhNTFBhcnNlciIsImVycm9ycyIsIlNlbGVjdFJlc3VsdHMiLCJpc09iamVjdCIsInBhcnNlWG1sIiwicmVhZGFibGVTdHJlYW0iLCJzYW5pdGl6ZUVUYWciLCJzYW5pdGl6ZU9iamVjdEtleSIsInNhbml0aXplU2l6ZSIsInRvQXJyYXkiLCJyZWFkQXNTdHJpbmciLCJSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMiLCJwYXJzZUJ1Y2tldFJlZ2lvbiIsInhtbCIsIkxvY2F0aW9uQ29uc3RyYWludCIsImZ4cCIsImZ4cFdpdGhvdXROdW1QYXJzZXIiLCJudW1iZXJQYXJzZU9wdGlvbnMiLCJza2lwTGlrZSIsInBhcnNlRXJyb3IiLCJoZWFkZXJJbmZvIiwieG1sRXJyIiwieG1sT2JqIiwicGFyc2UiLCJFcnJvciIsImUiLCJTM0Vycm9yIiwiT2JqZWN0IiwiZW50cmllcyIsImZvckVhY2giLCJrZXkiLCJ2YWx1ZSIsInRvTG93ZXJDYXNlIiwicGFyc2VSZXNwb25zZUVycm9yIiwicmVzcG9uc2UiLCJzdGF0dXNDb2RlIiwiY29kZSIsIm1lc3NhZ2UiLCJoRXJyQ29kZSIsImhlYWRlcnMiLCJoRXJyRGVzYyIsImFtelJlcXVlc3RpZCIsImFteklkMiIsImFtekJ1Y2tldFJlZ2lvbiIsInhtbFN0cmluZyIsImNhdXNlIiwicGFyc2VMaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhIiwicmVzdWx0Iiwib2JqZWN0cyIsImlzVHJ1bmNhdGVkIiwibmV4dENvbnRpbnVhdGlvblRva2VuIiwieG1sb2JqIiwiTGlzdEJ1Y2tldFJlc3VsdCIsIkludmFsaWRYTUxFcnJvciIsIklzVHJ1bmNhdGVkIiwiTmV4dENvbnRpbnVhdGlvblRva2VuIiwiQ29udGVudHMiLCJjb250ZW50IiwibmFtZSIsIktleSIsImxhc3RNb2RpZmllZCIsIkRhdGUiLCJMYXN0TW9kaWZpZWQiLCJldGFnIiwiRVRhZyIsInNpemUiLCJTaXplIiwidGFncyIsIlVzZXJUYWdzIiwic3BsaXQiLCJ0YWciLCJtZXRhZGF0YSIsIlVzZXJNZXRhZGF0YSIsInB1c2giLCJDb21tb25QcmVmaXhlcyIsImNvbW1vblByZWZpeCIsInByZWZpeCIsIlByZWZpeCIsInBhcnNlTGlzdFBhcnRzIiwicGFydHMiLCJtYXJrZXIiLCJMaXN0UGFydHNSZXN1bHQiLCJOZXh0UGFydE51bWJlck1hcmtlciIsIlBhcnQiLCJwIiwicGFydCIsInBhcnNlSW50IiwiUGFydE51bWJlciIsInJlcGxhY2UiLCJwYXJzZUxpc3RCdWNrZXQiLCJsaXN0QnVja2V0UmVzdWx0UGFyc2VyIiwicGFyc2VUYWdWYWx1ZSIsImxlYWRpbmdaZXJvcyIsImhleCIsInRhZ1ZhbHVlUHJvY2Vzc29yIiwidGFnTmFtZSIsInRhZ1ZhbHVlIiwidG9TdHJpbmciLCJpZ25vcmVBdHRyaWJ1dGVzIiwicGFyc2VkWG1sUmVzIiwiTGlzdEFsbE15QnVja2V0c1Jlc3VsdCIsIkJ1Y2tldHMiLCJCdWNrZXQiLCJtYXAiLCJidWNrZXQiLCJOYW1lIiwiYnVja2V0TmFtZSIsIkNyZWF0aW9uRGF0ZSIsImNyZWF0aW9uRGF0ZSIsInBhcnNlSW5pdGlhdGVNdWx0aXBhcnQiLCJJbml0aWF0ZU11bHRpcGFydFVwbG9hZFJlc3VsdCIsIlVwbG9hZElkIiwicGFyc2VSZXBsaWNhdGlvbkNvbmZpZyIsIlJvbGUiLCJSdWxlIiwiUmVwbGljYXRpb25Db25maWd1cmF0aW9uIiwicm9sZSIsInJ1bGVzIiwicGFyc2VPYmplY3RMZWdhbEhvbGRDb25maWciLCJMZWdhbEhvbGQiLCJwYXJzZVRhZ2dpbmciLCJUYWdnaW5nIiwiVGFnU2V0IiwiVGFnIiwidGFnUmVzdWx0IiwicGFyc2VDb21wbGV0ZU11bHRpcGFydCIsIkNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkUmVzdWx0IiwiTG9jYXRpb24iLCJsb2NhdGlvbiIsIkNvZGUiLCJNZXNzYWdlIiwiZXJyQ29kZSIsImVyck1lc3NhZ2UiLCJwYXJzZUxpc3RNdWx0aXBhcnQiLCJwcmVmaXhlcyIsInVwbG9hZHMiLCJuZXh0S2V5TWFya2VyIiwibmV4dFVwbG9hZElkTWFya2VyIiwiTGlzdE11bHRpcGFydFVwbG9hZHNSZXN1bHQiLCJOZXh0S2V5TWFya2VyIiwiTmV4dFVwbG9hZElkTWFya2VyIiwiVXBsb2FkIiwidXBsb2FkIiwidXBsb2FkSXRlbSIsInVwbG9hZElkIiwic3RvcmFnZUNsYXNzIiwiU3RvcmFnZUNsYXNzIiwiaW5pdGlhdGVkIiwiSW5pdGlhdGVkIiwiSW5pdGlhdG9yIiwiaW5pdGlhdG9yIiwiaWQiLCJJRCIsImRpc3BsYXlOYW1lIiwiRGlzcGxheU5hbWUiLCJPd25lciIsIm93bmVyIiwicGFyc2VPYmplY3RMb2NrQ29uZmlnIiwibG9ja0NvbmZpZ1Jlc3VsdCIsIk9iamVjdExvY2tDb25maWd1cmF0aW9uIiwib2JqZWN0TG9ja0VuYWJsZWQiLCJPYmplY3RMb2NrRW5hYmxlZCIsInJldGVudGlvblJlc3AiLCJEZWZhdWx0UmV0ZW50aW9uIiwibW9kZSIsIk1vZGUiLCJpc1VuaXRZZWFycyIsIlllYXJzIiwidmFsaWRpdHkiLCJ1bml0IiwiWUVBUlMiLCJEYXlzIiwiREFZUyIsInBhcnNlQnVja2V0VmVyc2lvbmluZ0NvbmZpZyIsIlZlcnNpb25pbmdDb25maWd1cmF0aW9uIiwiZXh0cmFjdEhlYWRlclR5cGUiLCJzdHJlYW0iLCJoZWFkZXJOYW1lTGVuIiwiQnVmZmVyIiwiZnJvbSIsInJlYWQiLCJyZWFkVUludDgiLCJoZWFkZXJOYW1lV2l0aFNlcGFyYXRvciIsInNwbGl0QnlTZXBhcmF0b3IiLCJsZW5ndGgiLCJleHRyYWN0SGVhZGVyVmFsdWUiLCJib2R5TGVuIiwicmVhZFVJbnQxNkJFIiwicGFyc2VTZWxlY3RPYmplY3RDb250ZW50UmVzcG9uc2UiLCJyZXMiLCJzZWxlY3RSZXN1bHRzIiwicmVzcG9uc2VTdHJlYW0iLCJfcmVhZGFibGVTdGF0ZSIsIm1zZ0NyY0FjY3VtdWxhdG9yIiwidG90YWxCeXRlTGVuZ3RoQnVmZmVyIiwiaGVhZGVyQnl0ZXNCdWZmZXIiLCJjYWxjdWxhdGVkUHJlbHVkZUNyYyIsInJlYWRJbnQzMkJFIiwicHJlbHVkZUNyY0J1ZmZlciIsInRvdGFsTXNnTGVuZ3RoIiwiaGVhZGVyTGVuZ3RoIiwicHJlbHVkZUNyY0J5dGVWYWx1ZSIsImhlYWRlckJ5dGVzIiwiaGVhZGVyUmVhZGVyU3RyZWFtIiwiaGVhZGVyVHlwZU5hbWUiLCJwYXlsb2FkU3RyZWFtIiwicGF5TG9hZExlbmd0aCIsInBheUxvYWRCdWZmZXIiLCJtZXNzYWdlQ3JjQnl0ZVZhbHVlIiwiY2FsY3VsYXRlZENyYyIsIm1lc3NhZ2VUeXBlIiwiZXJyb3JNZXNzYWdlIiwiY29udGVudFR5cGUiLCJldmVudFR5cGUiLCJzZXRSZXNwb25zZSIsIl9wYXlsb2FkU3RyZWFtIiwicmVhZERhdGEiLCJzZXRSZWNvcmRzIiwiX3BheWxvYWRTdHJlYW0yIiwicHJvZ3Jlc3NEYXRhIiwic2V0UHJvZ3Jlc3MiLCJfcGF5bG9hZFN0cmVhbTMiLCJzdGF0c0RhdGEiLCJzZXRTdGF0cyIsIndhcm5pbmdNZXNzYWdlIiwiY29uc29sZSIsIndhcm4iLCJwYXJzZUxpZmVjeWNsZUNvbmZpZyIsIkxpZmVjeWNsZUNvbmZpZ3VyYXRpb24iLCJwYXJzZUJ1Y2tldEVuY3J5cHRpb25Db25maWciLCJwYXJzZU9iamVjdFJldGVudGlvbkNvbmZpZyIsInJldGVudGlvbkNvbmZpZyIsIlJldGVudGlvbiIsInJldGFpblVudGlsRGF0ZSIsIlJldGFpblVudGlsRGF0ZSIsInJlbW92ZU9iamVjdHNQYXJzZXIiLCJEZWxldGVSZXN1bHQiLCJwYXJzZUNvcHlPYmplY3QiLCJDb3B5T2JqZWN0UmVzdWx0IiwiZm9ybWF0T2JqSW5mbyIsIm9wdHMiLCJWZXJzaW9uSWQiLCJJc0xhdGVzdCIsInVuZGVmaW5lZCIsInZlcnNpb25JZCIsImlzTGF0ZXN0IiwiaXNEZWxldGVNYXJrZXIiLCJJc0RlbGV0ZU1hcmtlciIsInBhcnNlTGlzdE9iamVjdHMiLCJuZXh0TWFya2VyIiwidmVyc2lvbklkTWFya2VyIiwibmV4dFZlcnNpb25LZXlNYXJrZXIiLCJwYXJzZUNvbW1vblByZWZpeGVzRW50aXR5IiwiY29tbW9uUHJlZml4RW50cnkiLCJsaXN0QnVja2V0UmVzdWx0IiwibGlzdFZlcnNpb25zUmVzdWx0IiwiTGlzdFZlcnNpb25zUmVzdWx0IiwiTWFya2VyIiwiX3Jlc3VsdCRvYmplY3RzIiwiVmVyc2lvbiIsIkRlbGV0ZU1hcmtlciIsIk5leHRWZXJzaW9uSWRNYXJrZXIiLCJ1cGxvYWRQYXJ0UGFyc2VyIiwicmVzcEVsIiwiQ29weVBhcnRSZXN1bHQiXSwic291cmNlcyI6WyJ4bWwtcGFyc2VyLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlICogYXMgaHR0cCBmcm9tICdub2RlOmh0dHAnXG5pbXBvcnQgdHlwZSBzdHJlYW0gZnJvbSAnbm9kZTpzdHJlYW0nXG5cbmltcG9ydCBjcmMzMiBmcm9tICdidWZmZXItY3JjMzInXG5pbXBvcnQgeyBYTUxQYXJzZXIgfSBmcm9tICdmYXN0LXhtbC1wYXJzZXInXG5cbmltcG9ydCAqIGFzIGVycm9ycyBmcm9tICcuLi9lcnJvcnMudHMnXG5pbXBvcnQgeyBTZWxlY3RSZXN1bHRzIH0gZnJvbSAnLi4vaGVscGVycy50cydcbmltcG9ydCB7IGlzT2JqZWN0LCBwYXJzZVhtbCwgcmVhZGFibGVTdHJlYW0sIHNhbml0aXplRVRhZywgc2FuaXRpemVPYmplY3RLZXksIHNhbml0aXplU2l6ZSwgdG9BcnJheSB9IGZyb20gJy4vaGVscGVyLnRzJ1xuaW1wb3J0IHsgcmVhZEFzU3RyaW5nIH0gZnJvbSAnLi9yZXNwb25zZS50cydcbmltcG9ydCB0eXBlIHtcbiAgQnVja2V0SXRlbUZyb21MaXN0LFxuICBCdWNrZXRJdGVtV2l0aE1ldGFkYXRhLFxuICBDb21tb25QcmVmaXgsXG4gIENvcHlPYmplY3RSZXN1bHRWMSxcbiAgTGlzdEJ1Y2tldFJlc3VsdFYxLFxuICBPYmplY3RJbmZvLFxuICBPYmplY3RMb2NrSW5mbyxcbiAgT2JqZWN0Um93RW50cnksXG4gIFJlcGxpY2F0aW9uQ29uZmlnLFxuICBUYWdzLFxufSBmcm9tICcuL3R5cGUudHMnXG5pbXBvcnQgeyBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMgfSBmcm9tICcuL3R5cGUudHMnXG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgYnVja2V0IHJlZ2lvblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQnVja2V0UmVnaW9uKHhtbDogc3RyaW5nKTogc3RyaW5nIHtcbiAgLy8gcmV0dXJuIHJlZ2lvbiBpbmZvcm1hdGlvblxuICByZXR1cm4gcGFyc2VYbWwoeG1sKS5Mb2NhdGlvbkNvbnN0cmFpbnRcbn1cblxuY29uc3QgZnhwID0gbmV3IFhNTFBhcnNlcigpXG5cbmNvbnN0IGZ4cFdpdGhvdXROdW1QYXJzZXIgPSBuZXcgWE1MUGFyc2VyKHtcbiAgLy8gQHRzLWlnbm9yZVxuICBudW1iZXJQYXJzZU9wdGlvbnM6IHtcbiAgICBza2lwTGlrZTogLy4vLFxuICB9LFxufSlcblxuLy8gUGFyc2UgWE1MIGFuZCByZXR1cm4gaW5mb3JtYXRpb24gYXMgSmF2YXNjcmlwdCB0eXBlc1xuLy8gcGFyc2UgZXJyb3IgWE1MIHJlc3BvbnNlXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VFcnJvcih4bWw6IHN0cmluZywgaGVhZGVySW5mbzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pIHtcbiAgbGV0IHhtbEVyciA9IHt9XG4gIGNvbnN0IHhtbE9iaiA9IGZ4cC5wYXJzZSh4bWwpXG4gIGlmICh4bWxPYmouRXJyb3IpIHtcbiAgICB4bWxFcnIgPSB4bWxPYmouRXJyb3JcbiAgfVxuICBjb25zdCBlID0gbmV3IGVycm9ycy5TM0Vycm9yKCkgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICBPYmplY3QuZW50cmllcyh4bWxFcnIpLmZvckVhY2goKFtrZXksIHZhbHVlXSkgPT4ge1xuICAgIGVba2V5LnRvTG93ZXJDYXNlKCldID0gdmFsdWVcbiAgfSlcbiAgT2JqZWN0LmVudHJpZXMoaGVhZGVySW5mbykuZm9yRWFjaCgoW2tleSwgdmFsdWVdKSA9PiB7XG4gICAgZVtrZXldID0gdmFsdWVcbiAgfSlcbiAgcmV0dXJuIGVcbn1cblxuLy8gR2VuZXJhdGVzIGFuIEVycm9yIG9iamVjdCBkZXBlbmRpbmcgb24gaHR0cCBzdGF0dXNDb2RlIGFuZCBYTUwgYm9keVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHBhcnNlUmVzcG9uc2VFcnJvcihyZXNwb25zZTogaHR0cC5JbmNvbWluZ01lc3NhZ2UpOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIHN0cmluZz4+IHtcbiAgY29uc3Qgc3RhdHVzQ29kZSA9IHJlc3BvbnNlLnN0YXR1c0NvZGVcbiAgbGV0IGNvZGUgPSAnJyxcbiAgICBtZXNzYWdlID0gJydcbiAgaWYgKHN0YXR1c0NvZGUgPT09IDMwMSkge1xuICAgIGNvZGUgPSAnTW92ZWRQZXJtYW5lbnRseSdcbiAgICBtZXNzYWdlID0gJ01vdmVkIFBlcm1hbmVudGx5J1xuICB9IGVsc2UgaWYgKHN0YXR1c0NvZGUgPT09IDMwNykge1xuICAgIGNvZGUgPSAnVGVtcG9yYXJ5UmVkaXJlY3QnXG4gICAgbWVzc2FnZSA9ICdBcmUgeW91IHVzaW5nIHRoZSBjb3JyZWN0IGVuZHBvaW50IFVSTD8nXG4gIH0gZWxzZSBpZiAoc3RhdHVzQ29kZSA9PT0gNDAzKSB7XG4gICAgY29kZSA9ICdBY2Nlc3NEZW5pZWQnXG4gICAgbWVzc2FnZSA9ICdWYWxpZCBhbmQgYXV0aG9yaXplZCBjcmVkZW50aWFscyByZXF1aXJlZCdcbiAgfSBlbHNlIGlmIChzdGF0dXNDb2RlID09PSA0MDQpIHtcbiAgICBjb2RlID0gJ05vdEZvdW5kJ1xuICAgIG1lc3NhZ2UgPSAnTm90IEZvdW5kJ1xuICB9IGVsc2UgaWYgKHN0YXR1c0NvZGUgPT09IDQwNSkge1xuICAgIGNvZGUgPSAnTWV0aG9kTm90QWxsb3dlZCdcbiAgICBtZXNzYWdlID0gJ01ldGhvZCBOb3QgQWxsb3dlZCdcbiAgfSBlbHNlIGlmIChzdGF0dXNDb2RlID09PSA1MDEpIHtcbiAgICBjb2RlID0gJ01ldGhvZE5vdEFsbG93ZWQnXG4gICAgbWVzc2FnZSA9ICdNZXRob2QgTm90IEFsbG93ZWQnXG4gIH0gZWxzZSBpZiAoc3RhdHVzQ29kZSA9PT0gNTAzKSB7XG4gICAgY29kZSA9ICdTbG93RG93bidcbiAgICBtZXNzYWdlID0gJ1BsZWFzZSByZWR1Y2UgeW91ciByZXF1ZXN0IHJhdGUuJ1xuICB9IGVsc2Uge1xuICAgIGNvbnN0IGhFcnJDb2RlID0gcmVzcG9uc2UuaGVhZGVyc1sneC1taW5pby1lcnJvci1jb2RlJ10gYXMgc3RyaW5nXG4gICAgY29uc3QgaEVyckRlc2MgPSByZXNwb25zZS5oZWFkZXJzWyd4LW1pbmlvLWVycm9yLWRlc2MnXSBhcyBzdHJpbmdcblxuICAgIGlmIChoRXJyQ29kZSAmJiBoRXJyRGVzYykge1xuICAgICAgY29kZSA9IGhFcnJDb2RlXG4gICAgICBtZXNzYWdlID0gaEVyckRlc2NcbiAgICB9XG4gIH1cbiAgY29uc3QgaGVhZGVySW5mbzogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbD4gPSB7fVxuICAvLyBBIHZhbHVlIGNyZWF0ZWQgYnkgUzMgY29tcGF0aWJsZSBzZXJ2ZXIgdGhhdCB1bmlxdWVseSBpZGVudGlmaWVzIHRoZSByZXF1ZXN0LlxuICBoZWFkZXJJbmZvLmFtelJlcXVlc3RpZCA9IHJlc3BvbnNlLmhlYWRlcnNbJ3gtYW16LXJlcXVlc3QtaWQnXSBhcyBzdHJpbmcgfCB1bmRlZmluZWRcbiAgLy8gQSBzcGVjaWFsIHRva2VuIHRoYXQgaGVscHMgdHJvdWJsZXNob290IEFQSSByZXBsaWVzIGFuZCBpc3N1ZXMuXG4gIGhlYWRlckluZm8uYW16SWQyID0gcmVzcG9uc2UuaGVhZGVyc1sneC1hbXotaWQtMiddIGFzIHN0cmluZyB8IHVuZGVmaW5lZFxuXG4gIC8vIFJlZ2lvbiB3aGVyZSB0aGUgYnVja2V0IGlzIGxvY2F0ZWQuIFRoaXMgaGVhZGVyIGlzIHJldHVybmVkIG9ubHlcbiAgLy8gaW4gSEVBRCBidWNrZXQgYW5kIExpc3RPYmplY3RzIHJlc3BvbnNlLlxuICBoZWFkZXJJbmZvLmFtekJ1Y2tldFJlZ2lvbiA9IHJlc3BvbnNlLmhlYWRlcnNbJ3gtYW16LWJ1Y2tldC1yZWdpb24nXSBhcyBzdHJpbmcgfCB1bmRlZmluZWRcblxuICBjb25zdCB4bWxTdHJpbmcgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzcG9uc2UpXG5cbiAgaWYgKHhtbFN0cmluZykge1xuICAgIHRocm93IHBhcnNlRXJyb3IoeG1sU3RyaW5nLCBoZWFkZXJJbmZvKVxuICB9XG5cbiAgLy8gTWVzc2FnZSBzaG91bGQgYmUgaW5zdGFudGlhdGVkIGZvciBlYWNoIFMzRXJyb3JzLlxuICBjb25zdCBlID0gbmV3IGVycm9ycy5TM0Vycm9yKG1lc3NhZ2UsIHsgY2F1c2U6IGhlYWRlckluZm8gfSlcbiAgLy8gUzMgRXJyb3IgY29kZS5cbiAgZS5jb2RlID0gY29kZVxuICBPYmplY3QuZW50cmllcyhoZWFkZXJJbmZvKS5mb3JFYWNoKChba2V5LCB2YWx1ZV0pID0+IHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yIGZvcmNlIHNldCBlcnJvciBwcm9wZXJ0aWVzXG4gICAgZVtrZXldID0gdmFsdWVcbiAgfSlcblxuICB0aHJvdyBlXG59XG5cbi8qKlxuICogcGFyc2UgWE1MIHJlc3BvbnNlIGZvciBsaXN0IG9iamVjdHMgdjIgd2l0aCBtZXRhZGF0YSBpbiBhIGJ1Y2tldFxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhKHhtbDogc3RyaW5nKSB7XG4gIGNvbnN0IHJlc3VsdDoge1xuICAgIG9iamVjdHM6IEFycmF5PEJ1Y2tldEl0ZW1XaXRoTWV0YWRhdGE+XG4gICAgaXNUcnVuY2F0ZWQ6IGJvb2xlYW5cbiAgICBuZXh0Q29udGludWF0aW9uVG9rZW46IHN0cmluZ1xuICB9ID0ge1xuICAgIG9iamVjdHM6IFtdLFxuICAgIGlzVHJ1bmNhdGVkOiBmYWxzZSxcbiAgICBuZXh0Q29udGludWF0aW9uVG9rZW46ICcnLFxuICB9XG5cbiAgbGV0IHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcbiAgaWYgKCF4bWxvYmouTGlzdEJ1Y2tldFJlc3VsdCkge1xuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJMaXN0QnVja2V0UmVzdWx0XCInKVxuICB9XG4gIHhtbG9iaiA9IHhtbG9iai5MaXN0QnVja2V0UmVzdWx0XG4gIGlmICh4bWxvYmouSXNUcnVuY2F0ZWQpIHtcbiAgICByZXN1bHQuaXNUcnVuY2F0ZWQgPSB4bWxvYmouSXNUcnVuY2F0ZWRcbiAgfVxuICBpZiAoeG1sb2JqLk5leHRDb250aW51YXRpb25Ub2tlbikge1xuICAgIHJlc3VsdC5uZXh0Q29udGludWF0aW9uVG9rZW4gPSB4bWxvYmouTmV4dENvbnRpbnVhdGlvblRva2VuXG4gIH1cblxuICBpZiAoeG1sb2JqLkNvbnRlbnRzKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ29udGVudHMpLmZvckVhY2goKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IG5hbWUgPSBzYW5pdGl6ZU9iamVjdEtleShjb250ZW50LktleSlcbiAgICAgIGNvbnN0IGxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKGNvbnRlbnQuTGFzdE1vZGlmaWVkKVxuICAgICAgY29uc3QgZXRhZyA9IHNhbml0aXplRVRhZyhjb250ZW50LkVUYWcpXG4gICAgICBjb25zdCBzaXplID0gY29udGVudC5TaXplXG5cbiAgICAgIGxldCB0YWdzOiBUYWdzID0ge31cbiAgICAgIGlmIChjb250ZW50LlVzZXJUYWdzICE9IG51bGwpIHtcbiAgICAgICAgdG9BcnJheShjb250ZW50LlVzZXJUYWdzLnNwbGl0KCcmJykpLmZvckVhY2goKHRhZykgPT4ge1xuICAgICAgICAgIGNvbnN0IFtrZXksIHZhbHVlXSA9IHRhZy5zcGxpdCgnPScpXG4gICAgICAgICAgdGFnc1trZXldID0gdmFsdWVcbiAgICAgICAgfSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRhZ3MgPSB7fVxuICAgICAgfVxuXG4gICAgICBsZXQgbWV0YWRhdGFcbiAgICAgIGlmIChjb250ZW50LlVzZXJNZXRhZGF0YSAhPSBudWxsKSB7XG4gICAgICAgIG1ldGFkYXRhID0gdG9BcnJheShjb250ZW50LlVzZXJNZXRhZGF0YSlbMF1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1ldGFkYXRhID0gbnVsbFxuICAgICAgfVxuICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IG5hbWUsIGxhc3RNb2RpZmllZCwgZXRhZywgc2l6ZSwgbWV0YWRhdGEsIHRhZ3MgfSlcbiAgICB9KVxuICB9XG5cbiAgaWYgKHhtbG9iai5Db21tb25QcmVmaXhlcykge1xuICAgIHRvQXJyYXkoeG1sb2JqLkNvbW1vblByZWZpeGVzKS5mb3JFYWNoKChjb21tb25QcmVmaXgpID0+IHtcbiAgICAgIHJlc3VsdC5vYmplY3RzLnB1c2goeyBwcmVmaXg6IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXkoY29tbW9uUHJlZml4LlByZWZpeClbMF0pLCBzaXplOiAwIH0pXG4gICAgfSlcbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbmV4cG9ydCB0eXBlIFVwbG9hZGVkUGFydCA9IHtcbiAgcGFydDogbnVtYmVyXG4gIGxhc3RNb2RpZmllZD86IERhdGVcbiAgZXRhZzogc3RyaW5nXG4gIHNpemU6IG51bWJlclxufVxuXG4vLyBwYXJzZSBYTUwgcmVzcG9uc2UgZm9yIGxpc3QgcGFydHMgb2YgYW4gaW4gcHJvZ3Jlc3MgbXVsdGlwYXJ0IHVwbG9hZFxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTGlzdFBhcnRzKHhtbDogc3RyaW5nKToge1xuICBpc1RydW5jYXRlZDogYm9vbGVhblxuICBtYXJrZXI6IG51bWJlclxuICBwYXJ0czogVXBsb2FkZWRQYXJ0W11cbn0ge1xuICBsZXQgeG1sb2JqID0gcGFyc2VYbWwoeG1sKVxuICBjb25zdCByZXN1bHQ6IHtcbiAgICBpc1RydW5jYXRlZDogYm9vbGVhblxuICAgIG1hcmtlcjogbnVtYmVyXG4gICAgcGFydHM6IFVwbG9hZGVkUGFydFtdXG4gIH0gPSB7XG4gICAgaXNUcnVuY2F0ZWQ6IGZhbHNlLFxuICAgIHBhcnRzOiBbXSxcbiAgICBtYXJrZXI6IDAsXG4gIH1cbiAgaWYgKCF4bWxvYmouTGlzdFBhcnRzUmVzdWx0KSB7XG4gICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkWE1MRXJyb3IoJ01pc3NpbmcgdGFnOiBcIkxpc3RQYXJ0c1Jlc3VsdFwiJylcbiAgfVxuICB4bWxvYmogPSB4bWxvYmouTGlzdFBhcnRzUmVzdWx0XG4gIGlmICh4bWxvYmouSXNUcnVuY2F0ZWQpIHtcbiAgICByZXN1bHQuaXNUcnVuY2F0ZWQgPSB4bWxvYmouSXNUcnVuY2F0ZWRcbiAgfVxuICBpZiAoeG1sb2JqLk5leHRQYXJ0TnVtYmVyTWFya2VyKSB7XG4gICAgcmVzdWx0Lm1hcmtlciA9IHRvQXJyYXkoeG1sb2JqLk5leHRQYXJ0TnVtYmVyTWFya2VyKVswXSB8fCAnJ1xuICB9XG4gIGlmICh4bWxvYmouUGFydCkge1xuICAgIHRvQXJyYXkoeG1sb2JqLlBhcnQpLmZvckVhY2goKHApID0+IHtcbiAgICAgIGNvbnN0IHBhcnQgPSBwYXJzZUludCh0b0FycmF5KHAuUGFydE51bWJlcilbMF0sIDEwKVxuICAgICAgY29uc3QgbGFzdE1vZGlmaWVkID0gbmV3IERhdGUocC5MYXN0TW9kaWZpZWQpXG4gICAgICBjb25zdCBldGFnID0gcC5FVGFnLnJlcGxhY2UoL15cIi9nLCAnJylcbiAgICAgICAgLnJlcGxhY2UoL1wiJC9nLCAnJylcbiAgICAgICAgLnJlcGxhY2UoL14mcXVvdDsvZywgJycpXG4gICAgICAgIC5yZXBsYWNlKC8mcXVvdDskL2csICcnKVxuICAgICAgICAucmVwbGFjZSgvXiYjMzQ7L2csICcnKVxuICAgICAgICAucmVwbGFjZSgvJiMzNDskL2csICcnKVxuICAgICAgcmVzdWx0LnBhcnRzLnB1c2goeyBwYXJ0LCBsYXN0TW9kaWZpZWQsIGV0YWcsIHNpemU6IHBhcnNlSW50KHAuU2l6ZSwgMTApIH0pXG4gICAgfSlcbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUxpc3RCdWNrZXQoeG1sOiBzdHJpbmcpOiBCdWNrZXRJdGVtRnJvbUxpc3RbXSB7XG4gIGxldCByZXN1bHQ6IEJ1Y2tldEl0ZW1Gcm9tTGlzdFtdID0gW11cbiAgY29uc3QgbGlzdEJ1Y2tldFJlc3VsdFBhcnNlciA9IG5ldyBYTUxQYXJzZXIoe1xuICAgIHBhcnNlVGFnVmFsdWU6IHRydWUsIC8vIEVuYWJsZSBwYXJzaW5nIG9mIHZhbHVlc1xuICAgIG51bWJlclBhcnNlT3B0aW9uczoge1xuICAgICAgbGVhZGluZ1plcm9zOiBmYWxzZSwgLy8gRGlzYWJsZSBudW1iZXIgcGFyc2luZyBmb3IgdmFsdWVzIHdpdGggbGVhZGluZyB6ZXJvc1xuICAgICAgaGV4OiBmYWxzZSwgLy8gRGlzYWJsZSBoZXggbnVtYmVyIHBhcnNpbmcgLSBJbnZhbGlkIGJ1Y2tldCBuYW1lXG4gICAgICBza2lwTGlrZTogL15bMC05XSskLywgLy8gU2tpcCBudW1iZXIgcGFyc2luZyBpZiB0aGUgdmFsdWUgY29uc2lzdHMgZW50aXJlbHkgb2YgZGlnaXRzXG4gICAgfSxcbiAgICB0YWdWYWx1ZVByb2Nlc3NvcjogKHRhZ05hbWUsIHRhZ1ZhbHVlID0gJycpID0+IHtcbiAgICAgIC8vIEVuc3VyZSB0aGF0IHRoZSBOYW1lIHRhZyBpcyBhbHdheXMgdHJlYXRlZCBhcyBhIHN0cmluZ1xuICAgICAgaWYgKHRhZ05hbWUgPT09ICdOYW1lJykge1xuICAgICAgICByZXR1cm4gdGFnVmFsdWUudG9TdHJpbmcoKVxuICAgICAgfVxuICAgICAgcmV0dXJuIHRhZ1ZhbHVlXG4gICAgfSxcbiAgICBpZ25vcmVBdHRyaWJ1dGVzOiBmYWxzZSwgLy8gRW5zdXJlIHRoYXQgYWxsIGF0dHJpYnV0ZXMgYXJlIHBhcnNlZFxuICB9KVxuXG4gIGNvbnN0IHBhcnNlZFhtbFJlcyA9IGxpc3RCdWNrZXRSZXN1bHRQYXJzZXIucGFyc2UoeG1sKVxuXG4gIGlmICghcGFyc2VkWG1sUmVzLkxpc3RBbGxNeUJ1Y2tldHNSZXN1bHQpIHtcbiAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRYTUxFcnJvcignTWlzc2luZyB0YWc6IFwiTGlzdEFsbE15QnVja2V0c1Jlc3VsdFwiJylcbiAgfVxuXG4gIGNvbnN0IHsgTGlzdEFsbE15QnVja2V0c1Jlc3VsdDogeyBCdWNrZXRzID0ge30gfSA9IHt9IH0gPSBwYXJzZWRYbWxSZXNcblxuICBpZiAoQnVja2V0cy5CdWNrZXQpIHtcbiAgICByZXN1bHQgPSB0b0FycmF5KEJ1Y2tldHMuQnVja2V0KS5tYXAoKGJ1Y2tldCA9IHt9KSA9PiB7XG4gICAgICBjb25zdCB7IE5hbWU6IGJ1Y2tldE5hbWUsIENyZWF0aW9uRGF0ZSB9ID0gYnVja2V0XG4gICAgICBjb25zdCBjcmVhdGlvbkRhdGUgPSBuZXcgRGF0ZShDcmVhdGlvbkRhdGUpXG5cbiAgICAgIHJldHVybiB7IG5hbWU6IGJ1Y2tldE5hbWUsIGNyZWF0aW9uRGF0ZSB9XG4gICAgfSlcbiAgfVxuXG4gIHJldHVybiByZXN1bHRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSW5pdGlhdGVNdWx0aXBhcnQoeG1sOiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgeG1sb2JqID0gcGFyc2VYbWwoeG1sKVxuXG4gIGlmICgheG1sb2JqLkluaXRpYXRlTXVsdGlwYXJ0VXBsb2FkUmVzdWx0KSB7XG4gICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkWE1MRXJyb3IoJ01pc3NpbmcgdGFnOiBcIkluaXRpYXRlTXVsdGlwYXJ0VXBsb2FkUmVzdWx0XCInKVxuICB9XG4gIHhtbG9iaiA9IHhtbG9iai5Jbml0aWF0ZU11bHRpcGFydFVwbG9hZFJlc3VsdFxuXG4gIGlmICh4bWxvYmouVXBsb2FkSWQpIHtcbiAgICByZXR1cm4geG1sb2JqLlVwbG9hZElkXG4gIH1cbiAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkWE1MRXJyb3IoJ01pc3NpbmcgdGFnOiBcIlVwbG9hZElkXCInKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VSZXBsaWNhdGlvbkNvbmZpZyh4bWw6IHN0cmluZyk6IFJlcGxpY2F0aW9uQ29uZmlnIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICBjb25zdCB7IFJvbGUsIFJ1bGUgfSA9IHhtbE9iai5SZXBsaWNhdGlvbkNvbmZpZ3VyYXRpb25cbiAgcmV0dXJuIHtcbiAgICBSZXBsaWNhdGlvbkNvbmZpZ3VyYXRpb246IHtcbiAgICAgIHJvbGU6IFJvbGUsXG4gICAgICBydWxlczogdG9BcnJheShSdWxlKSxcbiAgICB9LFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU9iamVjdExlZ2FsSG9sZENvbmZpZyh4bWw6IHN0cmluZykge1xuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXG4gIHJldHVybiB4bWxPYmouTGVnYWxIb2xkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVRhZ2dpbmcoeG1sOiBzdHJpbmcpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICBsZXQgcmVzdWx0ID0gW11cbiAgaWYgKHhtbE9iai5UYWdnaW5nICYmIHhtbE9iai5UYWdnaW5nLlRhZ1NldCAmJiB4bWxPYmouVGFnZ2luZy5UYWdTZXQuVGFnKSB7XG4gICAgY29uc3QgdGFnUmVzdWx0ID0geG1sT2JqLlRhZ2dpbmcuVGFnU2V0LlRhZ1xuICAgIC8vIGlmIGl0IGlzIGEgc2luZ2xlIHRhZyBjb252ZXJ0IGludG8gYW4gYXJyYXkgc28gdGhhdCB0aGUgcmV0dXJuIHZhbHVlIGlzIGFsd2F5cyBhbiBhcnJheS5cbiAgICBpZiAoaXNPYmplY3QodGFnUmVzdWx0KSkge1xuICAgICAgcmVzdWx0LnB1c2godGFnUmVzdWx0KVxuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHQgPSB0YWdSZXN1bHRcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG4vLyBwYXJzZSBYTUwgcmVzcG9uc2Ugd2hlbiBhIG11bHRpcGFydCB1cGxvYWQgaXMgY29tcGxldGVkXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21wbGV0ZU11bHRpcGFydCh4bWw6IHN0cmluZykge1xuICBjb25zdCB4bWxvYmogPSBwYXJzZVhtbCh4bWwpLkNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkUmVzdWx0XG4gIGlmICh4bWxvYmouTG9jYXRpb24pIHtcbiAgICBjb25zdCBsb2NhdGlvbiA9IHRvQXJyYXkoeG1sb2JqLkxvY2F0aW9uKVswXVxuICAgIGNvbnN0IGJ1Y2tldCA9IHRvQXJyYXkoeG1sb2JqLkJ1Y2tldClbMF1cbiAgICBjb25zdCBrZXkgPSB4bWxvYmouS2V5XG4gICAgY29uc3QgZXRhZyA9IHhtbG9iai5FVGFnLnJlcGxhY2UoL15cIi9nLCAnJylcbiAgICAgIC5yZXBsYWNlKC9cIiQvZywgJycpXG4gICAgICAucmVwbGFjZSgvXiZxdW90Oy9nLCAnJylcbiAgICAgIC5yZXBsYWNlKC8mcXVvdDskL2csICcnKVxuICAgICAgLnJlcGxhY2UoL14mIzM0Oy9nLCAnJylcbiAgICAgIC5yZXBsYWNlKC8mIzM0OyQvZywgJycpXG5cbiAgICByZXR1cm4geyBsb2NhdGlvbiwgYnVja2V0LCBrZXksIGV0YWcgfVxuICB9XG4gIC8vIENvbXBsZXRlIE11bHRpcGFydCBjYW4gcmV0dXJuIFhNTCBFcnJvciBhZnRlciBhIDIwMCBPSyByZXNwb25zZVxuICBpZiAoeG1sb2JqLkNvZGUgJiYgeG1sb2JqLk1lc3NhZ2UpIHtcbiAgICBjb25zdCBlcnJDb2RlID0gdG9BcnJheSh4bWxvYmouQ29kZSlbMF1cbiAgICBjb25zdCBlcnJNZXNzYWdlID0gdG9BcnJheSh4bWxvYmouTWVzc2FnZSlbMF1cbiAgICByZXR1cm4geyBlcnJDb2RlLCBlcnJNZXNzYWdlIH1cbiAgfVxufVxuXG50eXBlIFVwbG9hZElEID0gc3RyaW5nXG5cbmV4cG9ydCB0eXBlIExpc3RNdWx0aXBhcnRSZXN1bHQgPSB7XG4gIHVwbG9hZHM6IHtcbiAgICBrZXk6IHN0cmluZ1xuICAgIHVwbG9hZElkOiBVcGxvYWRJRFxuICAgIGluaXRpYXRvcj86IHsgaWQ6IHN0cmluZzsgZGlzcGxheU5hbWU6IHN0cmluZyB9XG4gICAgb3duZXI/OiB7IGlkOiBzdHJpbmc7IGRpc3BsYXlOYW1lOiBzdHJpbmcgfVxuICAgIHN0b3JhZ2VDbGFzczogdW5rbm93blxuICAgIGluaXRpYXRlZDogRGF0ZVxuICB9W11cbiAgcHJlZml4ZXM6IHtcbiAgICBwcmVmaXg6IHN0cmluZ1xuICB9W11cbiAgaXNUcnVuY2F0ZWQ6IGJvb2xlYW5cbiAgbmV4dEtleU1hcmtlcjogc3RyaW5nXG4gIG5leHRVcGxvYWRJZE1hcmtlcjogc3RyaW5nXG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdGluZyBpbi1wcm9ncmVzcyBtdWx0aXBhcnQgdXBsb2Fkc1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTGlzdE11bHRpcGFydCh4bWw6IHN0cmluZyk6IExpc3RNdWx0aXBhcnRSZXN1bHQge1xuICBjb25zdCByZXN1bHQ6IExpc3RNdWx0aXBhcnRSZXN1bHQgPSB7XG4gICAgcHJlZml4ZXM6IFtdLFxuICAgIHVwbG9hZHM6IFtdLFxuICAgIGlzVHJ1bmNhdGVkOiBmYWxzZSxcbiAgICBuZXh0S2V5TWFya2VyOiAnJyxcbiAgICBuZXh0VXBsb2FkSWRNYXJrZXI6ICcnLFxuICB9XG5cbiAgbGV0IHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcblxuICBpZiAoIXhtbG9iai5MaXN0TXVsdGlwYXJ0VXBsb2Fkc1Jlc3VsdCkge1xuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJMaXN0TXVsdGlwYXJ0VXBsb2Fkc1Jlc3VsdFwiJylcbiAgfVxuICB4bWxvYmogPSB4bWxvYmouTGlzdE11bHRpcGFydFVwbG9hZHNSZXN1bHRcbiAgaWYgKHhtbG9iai5Jc1RydW5jYXRlZCkge1xuICAgIHJlc3VsdC5pc1RydW5jYXRlZCA9IHhtbG9iai5Jc1RydW5jYXRlZFxuICB9XG4gIGlmICh4bWxvYmouTmV4dEtleU1hcmtlcikge1xuICAgIHJlc3VsdC5uZXh0S2V5TWFya2VyID0geG1sb2JqLk5leHRLZXlNYXJrZXJcbiAgfVxuICBpZiAoeG1sb2JqLk5leHRVcGxvYWRJZE1hcmtlcikge1xuICAgIHJlc3VsdC5uZXh0VXBsb2FkSWRNYXJrZXIgPSB4bWxvYmoubmV4dFVwbG9hZElkTWFya2VyIHx8ICcnXG4gIH1cblxuICBpZiAoeG1sb2JqLkNvbW1vblByZWZpeGVzKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ29tbW9uUHJlZml4ZXMpLmZvckVhY2goKHByZWZpeCkgPT4ge1xuICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvciBpbmRleCBjaGVja1xuICAgICAgcmVzdWx0LnByZWZpeGVzLnB1c2goeyBwcmVmaXg6IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXk8c3RyaW5nPihwcmVmaXguUHJlZml4KVswXSkgfSlcbiAgICB9KVxuICB9XG5cbiAgaWYgKHhtbG9iai5VcGxvYWQpIHtcbiAgICB0b0FycmF5KHhtbG9iai5VcGxvYWQpLmZvckVhY2goKHVwbG9hZCkgPT4ge1xuICAgICAgY29uc3QgdXBsb2FkSXRlbTogTGlzdE11bHRpcGFydFJlc3VsdFsndXBsb2FkcyddW251bWJlcl0gPSB7XG4gICAgICAgIGtleTogdXBsb2FkLktleSxcbiAgICAgICAgdXBsb2FkSWQ6IHVwbG9hZC5VcGxvYWRJZCxcbiAgICAgICAgc3RvcmFnZUNsYXNzOiB1cGxvYWQuU3RvcmFnZUNsYXNzLFxuICAgICAgICBpbml0aWF0ZWQ6IG5ldyBEYXRlKHVwbG9hZC5Jbml0aWF0ZWQpLFxuICAgICAgfVxuICAgICAgaWYgKHVwbG9hZC5Jbml0aWF0b3IpIHtcbiAgICAgICAgdXBsb2FkSXRlbS5pbml0aWF0b3IgPSB7IGlkOiB1cGxvYWQuSW5pdGlhdG9yLklELCBkaXNwbGF5TmFtZTogdXBsb2FkLkluaXRpYXRvci5EaXNwbGF5TmFtZSB9XG4gICAgICB9XG4gICAgICBpZiAodXBsb2FkLk93bmVyKSB7XG4gICAgICAgIHVwbG9hZEl0ZW0ub3duZXIgPSB7IGlkOiB1cGxvYWQuT3duZXIuSUQsIGRpc3BsYXlOYW1lOiB1cGxvYWQuT3duZXIuRGlzcGxheU5hbWUgfVxuICAgICAgfVxuICAgICAgcmVzdWx0LnVwbG9hZHMucHVzaCh1cGxvYWRJdGVtKVxuICAgIH0pXG4gIH1cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VPYmplY3RMb2NrQ29uZmlnKHhtbDogc3RyaW5nKTogT2JqZWN0TG9ja0luZm8ge1xuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXG4gIGxldCBsb2NrQ29uZmlnUmVzdWx0ID0ge30gYXMgT2JqZWN0TG9ja0luZm9cbiAgaWYgKHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbikge1xuICAgIGxvY2tDb25maWdSZXN1bHQgPSB7XG4gICAgICBvYmplY3RMb2NrRW5hYmxlZDogeG1sT2JqLk9iamVjdExvY2tDb25maWd1cmF0aW9uLk9iamVjdExvY2tFbmFibGVkLFxuICAgIH0gYXMgT2JqZWN0TG9ja0luZm9cbiAgICBsZXQgcmV0ZW50aW9uUmVzcFxuICAgIGlmIChcbiAgICAgIHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbiAmJlxuICAgICAgeG1sT2JqLk9iamVjdExvY2tDb25maWd1cmF0aW9uLlJ1bGUgJiZcbiAgICAgIHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbi5SdWxlLkRlZmF1bHRSZXRlbnRpb25cbiAgICApIHtcbiAgICAgIHJldGVudGlvblJlc3AgPSB4bWxPYmouT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24uUnVsZS5EZWZhdWx0UmV0ZW50aW9uIHx8IHt9XG4gICAgICBsb2NrQ29uZmlnUmVzdWx0Lm1vZGUgPSByZXRlbnRpb25SZXNwLk1vZGVcbiAgICB9XG4gICAgaWYgKHJldGVudGlvblJlc3ApIHtcbiAgICAgIGNvbnN0IGlzVW5pdFllYXJzID0gcmV0ZW50aW9uUmVzcC5ZZWFyc1xuICAgICAgaWYgKGlzVW5pdFllYXJzKSB7XG4gICAgICAgIGxvY2tDb25maWdSZXN1bHQudmFsaWRpdHkgPSBpc1VuaXRZZWFyc1xuICAgICAgICBsb2NrQ29uZmlnUmVzdWx0LnVuaXQgPSBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMuWUVBUlNcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxvY2tDb25maWdSZXN1bHQudmFsaWRpdHkgPSByZXRlbnRpb25SZXNwLkRheXNcbiAgICAgICAgbG9ja0NvbmZpZ1Jlc3VsdC51bml0ID0gUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLkRBWVNcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbG9ja0NvbmZpZ1Jlc3VsdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VCdWNrZXRWZXJzaW9uaW5nQ29uZmlnKHhtbDogc3RyaW5nKSB7XG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcbiAgcmV0dXJuIHhtbE9iai5WZXJzaW9uaW5nQ29uZmlndXJhdGlvblxufVxuXG4vLyBVc2VkIG9ubHkgaW4gc2VsZWN0T2JqZWN0Q29udGVudCBBUEkuXG4vLyBleHRyYWN0SGVhZGVyVHlwZSBleHRyYWN0cyB0aGUgZmlyc3QgaGFsZiBvZiB0aGUgaGVhZGVyIG1lc3NhZ2UsIHRoZSBoZWFkZXIgdHlwZS5cbmZ1bmN0aW9uIGV4dHJhY3RIZWFkZXJUeXBlKHN0cmVhbTogc3RyZWFtLlJlYWRhYmxlKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgaGVhZGVyTmFtZUxlbiA9IEJ1ZmZlci5mcm9tKHN0cmVhbS5yZWFkKDEpKS5yZWFkVUludDgoKVxuICBjb25zdCBoZWFkZXJOYW1lV2l0aFNlcGFyYXRvciA9IEJ1ZmZlci5mcm9tKHN0cmVhbS5yZWFkKGhlYWRlck5hbWVMZW4pKS50b1N0cmluZygpXG4gIGNvbnN0IHNwbGl0QnlTZXBhcmF0b3IgPSAoaGVhZGVyTmFtZVdpdGhTZXBhcmF0b3IgfHwgJycpLnNwbGl0KCc6JylcbiAgcmV0dXJuIHNwbGl0QnlTZXBhcmF0b3IubGVuZ3RoID49IDEgPyBzcGxpdEJ5U2VwYXJhdG9yWzFdIDogJydcbn1cblxuZnVuY3Rpb24gZXh0cmFjdEhlYWRlclZhbHVlKHN0cmVhbTogc3RyZWFtLlJlYWRhYmxlKSB7XG4gIGNvbnN0IGJvZHlMZW4gPSBCdWZmZXIuZnJvbShzdHJlYW0ucmVhZCgyKSkucmVhZFVJbnQxNkJFKClcbiAgcmV0dXJuIEJ1ZmZlci5mcm9tKHN0cmVhbS5yZWFkKGJvZHlMZW4pKS50b1N0cmluZygpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVNlbGVjdE9iamVjdENvbnRlbnRSZXNwb25zZShyZXM6IEJ1ZmZlcikge1xuICBjb25zdCBzZWxlY3RSZXN1bHRzID0gbmV3IFNlbGVjdFJlc3VsdHMoe30pIC8vIHdpbGwgYmUgcmV0dXJuZWRcblxuICBjb25zdCByZXNwb25zZVN0cmVhbSA9IHJlYWRhYmxlU3RyZWFtKHJlcykgLy8gY29udmVydCBieXRlIGFycmF5IHRvIGEgcmVhZGFibGUgcmVzcG9uc2VTdHJlYW1cbiAgLy8gQHRzLWlnbm9yZVxuICB3aGlsZSAocmVzcG9uc2VTdHJlYW0uX3JlYWRhYmxlU3RhdGUubGVuZ3RoKSB7XG4gICAgLy8gVG9wIGxldmVsIHJlc3BvbnNlU3RyZWFtIHJlYWQgdHJhY2tlci5cbiAgICBsZXQgbXNnQ3JjQWNjdW11bGF0b3IgLy8gYWNjdW11bGF0ZSBmcm9tIHN0YXJ0IG9mIHRoZSBtZXNzYWdlIHRpbGwgdGhlIG1lc3NhZ2UgY3JjIHN0YXJ0LlxuXG4gICAgY29uc3QgdG90YWxCeXRlTGVuZ3RoQnVmZmVyID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZCg0KSlcbiAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKHRvdGFsQnl0ZUxlbmd0aEJ1ZmZlcilcblxuICAgIGNvbnN0IGhlYWRlckJ5dGVzQnVmZmVyID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZCg0KSlcbiAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKGhlYWRlckJ5dGVzQnVmZmVyLCBtc2dDcmNBY2N1bXVsYXRvcilcblxuICAgIGNvbnN0IGNhbGN1bGF0ZWRQcmVsdWRlQ3JjID0gbXNnQ3JjQWNjdW11bGF0b3IucmVhZEludDMyQkUoKSAvLyB1c2UgaXQgdG8gY2hlY2sgaWYgYW55IENSQyBtaXNtYXRjaCBpbiBoZWFkZXIgaXRzZWxmLlxuXG4gICAgY29uc3QgcHJlbHVkZUNyY0J1ZmZlciA9IEJ1ZmZlci5mcm9tKHJlc3BvbnNlU3RyZWFtLnJlYWQoNCkpIC8vIHJlYWQgNCBieXRlcyAgICBpLmUgNCs0ID04ICsgNCA9IDEyICggcHJlbHVkZSArIHByZWx1ZGUgY3JjKVxuICAgIG1zZ0NyY0FjY3VtdWxhdG9yID0gY3JjMzIocHJlbHVkZUNyY0J1ZmZlciwgbXNnQ3JjQWNjdW11bGF0b3IpXG5cbiAgICBjb25zdCB0b3RhbE1zZ0xlbmd0aCA9IHRvdGFsQnl0ZUxlbmd0aEJ1ZmZlci5yZWFkSW50MzJCRSgpXG4gICAgY29uc3QgaGVhZGVyTGVuZ3RoID0gaGVhZGVyQnl0ZXNCdWZmZXIucmVhZEludDMyQkUoKVxuICAgIGNvbnN0IHByZWx1ZGVDcmNCeXRlVmFsdWUgPSBwcmVsdWRlQ3JjQnVmZmVyLnJlYWRJbnQzMkJFKClcblxuICAgIGlmIChwcmVsdWRlQ3JjQnl0ZVZhbHVlICE9PSBjYWxjdWxhdGVkUHJlbHVkZUNyYykge1xuICAgICAgLy8gSGFuZGxlIEhlYWRlciBDUkMgbWlzbWF0Y2ggRXJyb3JcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYEhlYWRlciBDaGVja3N1bSBNaXNtYXRjaCwgUHJlbHVkZSBDUkMgb2YgJHtwcmVsdWRlQ3JjQnl0ZVZhbHVlfSBkb2VzIG5vdCBlcXVhbCBleHBlY3RlZCBDUkMgb2YgJHtjYWxjdWxhdGVkUHJlbHVkZUNyY31gLFxuICAgICAgKVxuICAgIH1cblxuICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge31cbiAgICBpZiAoaGVhZGVyTGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgaGVhZGVyQnl0ZXMgPSBCdWZmZXIuZnJvbShyZXNwb25zZVN0cmVhbS5yZWFkKGhlYWRlckxlbmd0aCkpXG4gICAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKGhlYWRlckJ5dGVzLCBtc2dDcmNBY2N1bXVsYXRvcilcbiAgICAgIGNvbnN0IGhlYWRlclJlYWRlclN0cmVhbSA9IHJlYWRhYmxlU3RyZWFtKGhlYWRlckJ5dGVzKVxuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgd2hpbGUgKGhlYWRlclJlYWRlclN0cmVhbS5fcmVhZGFibGVTdGF0ZS5sZW5ndGgpIHtcbiAgICAgICAgY29uc3QgaGVhZGVyVHlwZU5hbWUgPSBleHRyYWN0SGVhZGVyVHlwZShoZWFkZXJSZWFkZXJTdHJlYW0pXG4gICAgICAgIGhlYWRlclJlYWRlclN0cmVhbS5yZWFkKDEpIC8vIGp1c3QgcmVhZCBhbmQgaWdub3JlIGl0LlxuICAgICAgICBpZiAoaGVhZGVyVHlwZU5hbWUpIHtcbiAgICAgICAgICBoZWFkZXJzW2hlYWRlclR5cGVOYW1lXSA9IGV4dHJhY3RIZWFkZXJWYWx1ZShoZWFkZXJSZWFkZXJTdHJlYW0pXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgcGF5bG9hZFN0cmVhbVxuICAgIGNvbnN0IHBheUxvYWRMZW5ndGggPSB0b3RhbE1zZ0xlbmd0aCAtIGhlYWRlckxlbmd0aCAtIDE2XG4gICAgaWYgKHBheUxvYWRMZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBwYXlMb2FkQnVmZmVyID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZChwYXlMb2FkTGVuZ3RoKSlcbiAgICAgIG1zZ0NyY0FjY3VtdWxhdG9yID0gY3JjMzIocGF5TG9hZEJ1ZmZlciwgbXNnQ3JjQWNjdW11bGF0b3IpXG4gICAgICAvLyByZWFkIHRoZSBjaGVja3N1bSBlYXJseSBhbmQgZGV0ZWN0IGFueSBtaXNtYXRjaCBzbyB3ZSBjYW4gYXZvaWQgdW5uZWNlc3NhcnkgZnVydGhlciBwcm9jZXNzaW5nLlxuICAgICAgY29uc3QgbWVzc2FnZUNyY0J5dGVWYWx1ZSA9IEJ1ZmZlci5mcm9tKHJlc3BvbnNlU3RyZWFtLnJlYWQoNCkpLnJlYWRJbnQzMkJFKClcbiAgICAgIGNvbnN0IGNhbGN1bGF0ZWRDcmMgPSBtc2dDcmNBY2N1bXVsYXRvci5yZWFkSW50MzJCRSgpXG4gICAgICAvLyBIYW5kbGUgbWVzc2FnZSBDUkMgRXJyb3JcbiAgICAgIGlmIChtZXNzYWdlQ3JjQnl0ZVZhbHVlICE9PSBjYWxjdWxhdGVkQ3JjKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBgTWVzc2FnZSBDaGVja3N1bSBNaXNtYXRjaCwgTWVzc2FnZSBDUkMgb2YgJHttZXNzYWdlQ3JjQnl0ZVZhbHVlfSBkb2VzIG5vdCBlcXVhbCBleHBlY3RlZCBDUkMgb2YgJHtjYWxjdWxhdGVkQ3JjfWAsXG4gICAgICAgIClcbiAgICAgIH1cbiAgICAgIHBheWxvYWRTdHJlYW0gPSByZWFkYWJsZVN0cmVhbShwYXlMb2FkQnVmZmVyKVxuICAgIH1cbiAgICBjb25zdCBtZXNzYWdlVHlwZSA9IGhlYWRlcnNbJ21lc3NhZ2UtdHlwZSddXG5cbiAgICBzd2l0Y2ggKG1lc3NhZ2VUeXBlKSB7XG4gICAgICBjYXNlICdlcnJvcic6IHtcbiAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gaGVhZGVyc1snZXJyb3ItY29kZSddICsgJzpcIicgKyBoZWFkZXJzWydlcnJvci1tZXNzYWdlJ10gKyAnXCInXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpXG4gICAgICB9XG4gICAgICBjYXNlICdldmVudCc6IHtcbiAgICAgICAgY29uc3QgY29udGVudFR5cGUgPSBoZWFkZXJzWydjb250ZW50LXR5cGUnXVxuICAgICAgICBjb25zdCBldmVudFR5cGUgPSBoZWFkZXJzWydldmVudC10eXBlJ11cblxuICAgICAgICBzd2l0Y2ggKGV2ZW50VHlwZSkge1xuICAgICAgICAgIGNhc2UgJ0VuZCc6IHtcbiAgICAgICAgICAgIHNlbGVjdFJlc3VsdHMuc2V0UmVzcG9uc2UocmVzKVxuICAgICAgICAgICAgcmV0dXJuIHNlbGVjdFJlc3VsdHNcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjYXNlICdSZWNvcmRzJzoge1xuICAgICAgICAgICAgY29uc3QgcmVhZERhdGEgPSBwYXlsb2FkU3RyZWFtPy5yZWFkKHBheUxvYWRMZW5ndGgpXG4gICAgICAgICAgICBzZWxlY3RSZXN1bHRzLnNldFJlY29yZHMocmVhZERhdGEpXG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNhc2UgJ1Byb2dyZXNzJzpcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3dpdGNoIChjb250ZW50VHlwZSkge1xuICAgICAgICAgICAgICAgIGNhc2UgJ3RleHQveG1sJzoge1xuICAgICAgICAgICAgICAgICAgY29uc3QgcHJvZ3Jlc3NEYXRhID0gcGF5bG9hZFN0cmVhbT8ucmVhZChwYXlMb2FkTGVuZ3RoKVxuICAgICAgICAgICAgICAgICAgc2VsZWN0UmVzdWx0cy5zZXRQcm9ncmVzcyhwcm9ncmVzc0RhdGEudG9TdHJpbmcoKSlcbiAgICAgICAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6IHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGBVbmV4cGVjdGVkIGNvbnRlbnQtdHlwZSAke2NvbnRlbnRUeXBlfSBzZW50IGZvciBldmVudC10eXBlIFByb2dyZXNzYFxuICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGVycm9yTWVzc2FnZSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgY2FzZSAnU3RhdHMnOlxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzd2l0Y2ggKGNvbnRlbnRUeXBlKSB7XG4gICAgICAgICAgICAgICAgY2FzZSAndGV4dC94bWwnOiB7XG4gICAgICAgICAgICAgICAgICBjb25zdCBzdGF0c0RhdGEgPSBwYXlsb2FkU3RyZWFtPy5yZWFkKHBheUxvYWRMZW5ndGgpXG4gICAgICAgICAgICAgICAgICBzZWxlY3RSZXN1bHRzLnNldFN0YXRzKHN0YXRzRGF0YS50b1N0cmluZygpKVxuICAgICAgICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZGVmYXVsdDoge1xuICAgICAgICAgICAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gYFVuZXhwZWN0ZWQgY29udGVudC10eXBlICR7Y29udGVudFR5cGV9IHNlbnQgZm9yIGV2ZW50LXR5cGUgU3RhdHNgXG4gICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICBkZWZhdWx0OiB7XG4gICAgICAgICAgICAvLyBDb250aW51YXRpb24gbWVzc2FnZTogTm90IHN1cmUgaWYgaXQgaXMgc3VwcG9ydGVkLiBkaWQgbm90IGZpbmQgYSByZWZlcmVuY2Ugb3IgYW55IG1lc3NhZ2UgaW4gcmVzcG9uc2UuXG4gICAgICAgICAgICAvLyBJdCBkb2VzIG5vdCBoYXZlIGEgcGF5bG9hZC5cbiAgICAgICAgICAgIGNvbnN0IHdhcm5pbmdNZXNzYWdlID0gYFVuIGltcGxlbWVudGVkIGV2ZW50IGRldGVjdGVkICAke21lc3NhZ2VUeXBlfS5gXG4gICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgICAgICAgICAgY29uc29sZS53YXJuKHdhcm5pbmdNZXNzYWdlKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaWZlY3ljbGVDb25maWcoeG1sOiBzdHJpbmcpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICByZXR1cm4geG1sT2JqLkxpZmVjeWNsZUNvbmZpZ3VyYXRpb25cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQnVja2V0RW5jcnlwdGlvbkNvbmZpZyh4bWw6IHN0cmluZykge1xuICByZXR1cm4gcGFyc2VYbWwoeG1sKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VPYmplY3RSZXRlbnRpb25Db25maWcoeG1sOiBzdHJpbmcpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICBjb25zdCByZXRlbnRpb25Db25maWcgPSB4bWxPYmouUmV0ZW50aW9uXG4gIHJldHVybiB7XG4gICAgbW9kZTogcmV0ZW50aW9uQ29uZmlnLk1vZGUsXG4gICAgcmV0YWluVW50aWxEYXRlOiByZXRlbnRpb25Db25maWcuUmV0YWluVW50aWxEYXRlLFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW1vdmVPYmplY3RzUGFyc2VyKHhtbDogc3RyaW5nKSB7XG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcbiAgaWYgKHhtbE9iai5EZWxldGVSZXN1bHQgJiYgeG1sT2JqLkRlbGV0ZVJlc3VsdC5FcnJvcikge1xuICAgIC8vIHJldHVybiBlcnJvcnMgYXMgYXJyYXkgYWx3YXlzLiBhcyB0aGUgcmVzcG9uc2UgaXMgb2JqZWN0IGluIGNhc2Ugb2Ygc2luZ2xlIG9iamVjdCBwYXNzZWQgaW4gcmVtb3ZlT2JqZWN0c1xuICAgIHJldHVybiB0b0FycmF5KHhtbE9iai5EZWxldGVSZXN1bHQuRXJyb3IpXG4gIH1cbiAgcmV0dXJuIFtdXG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgY29weSBvYmplY3RcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvcHlPYmplY3QoeG1sOiBzdHJpbmcpOiBDb3B5T2JqZWN0UmVzdWx0VjEge1xuICBjb25zdCByZXN1bHQ6IENvcHlPYmplY3RSZXN1bHRWMSA9IHtcbiAgICBldGFnOiAnJyxcbiAgICBsYXN0TW9kaWZpZWQ6ICcnLFxuICB9XG5cbiAgbGV0IHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcbiAgaWYgKCF4bWxvYmouQ29weU9iamVjdFJlc3VsdCkge1xuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJDb3B5T2JqZWN0UmVzdWx0XCInKVxuICB9XG4gIHhtbG9iaiA9IHhtbG9iai5Db3B5T2JqZWN0UmVzdWx0XG4gIGlmICh4bWxvYmouRVRhZykge1xuICAgIHJlc3VsdC5ldGFnID0geG1sb2JqLkVUYWcucmVwbGFjZSgvXlwiL2csICcnKVxuICAgICAgLnJlcGxhY2UoL1wiJC9nLCAnJylcbiAgICAgIC5yZXBsYWNlKC9eJnF1b3Q7L2csICcnKVxuICAgICAgLnJlcGxhY2UoLyZxdW90OyQvZywgJycpXG4gICAgICAucmVwbGFjZSgvXiYjMzQ7L2csICcnKVxuICAgICAgLnJlcGxhY2UoLyYjMzQ7JC9nLCAnJylcbiAgfVxuICBpZiAoeG1sb2JqLkxhc3RNb2RpZmllZCkge1xuICAgIHJlc3VsdC5sYXN0TW9kaWZpZWQgPSBuZXcgRGF0ZSh4bWxvYmouTGFzdE1vZGlmaWVkKVxuICB9XG5cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG5jb25zdCBmb3JtYXRPYmpJbmZvID0gKGNvbnRlbnQ6IE9iamVjdFJvd0VudHJ5LCBvcHRzOiB7IElzRGVsZXRlTWFya2VyPzogYm9vbGVhbiB9ID0ge30pID0+IHtcbiAgY29uc3QgeyBLZXksIExhc3RNb2RpZmllZCwgRVRhZywgU2l6ZSwgVmVyc2lvbklkLCBJc0xhdGVzdCB9ID0gY29udGVudFxuXG4gIGlmICghaXNPYmplY3Qob3B0cykpIHtcbiAgICBvcHRzID0ge31cbiAgfVxuXG4gIGNvbnN0IG5hbWUgPSBzYW5pdGl6ZU9iamVjdEtleSh0b0FycmF5KEtleSlbMF0gfHwgJycpXG4gIGNvbnN0IGxhc3RNb2RpZmllZCA9IExhc3RNb2RpZmllZCA/IG5ldyBEYXRlKHRvQXJyYXkoTGFzdE1vZGlmaWVkKVswXSB8fCAnJykgOiB1bmRlZmluZWRcbiAgY29uc3QgZXRhZyA9IHNhbml0aXplRVRhZyh0b0FycmF5KEVUYWcpWzBdIHx8ICcnKVxuICBjb25zdCBzaXplID0gc2FuaXRpemVTaXplKFNpemUgfHwgJycpXG5cbiAgcmV0dXJuIHtcbiAgICBuYW1lLFxuICAgIGxhc3RNb2RpZmllZCxcbiAgICBldGFnLFxuICAgIHNpemUsXG4gICAgdmVyc2lvbklkOiBWZXJzaW9uSWQsXG4gICAgaXNMYXRlc3Q6IElzTGF0ZXN0LFxuICAgIGlzRGVsZXRlTWFya2VyOiBvcHRzLklzRGVsZXRlTWFya2VyID8gb3B0cy5Jc0RlbGV0ZU1hcmtlciA6IGZhbHNlLFxuICB9XG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdCBvYmplY3RzIGluIGEgYnVja2V0XG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaXN0T2JqZWN0cyh4bWw6IHN0cmluZykge1xuICBjb25zdCByZXN1bHQ6IHsgb2JqZWN0czogT2JqZWN0SW5mb1tdOyBpc1RydW5jYXRlZD86IGJvb2xlYW47IG5leHRNYXJrZXI/OiBzdHJpbmc7IHZlcnNpb25JZE1hcmtlcj86IHN0cmluZyB9ID0ge1xuICAgIG9iamVjdHM6IFtdLFxuICAgIGlzVHJ1bmNhdGVkOiBmYWxzZSxcbiAgICBuZXh0TWFya2VyOiB1bmRlZmluZWQsXG4gICAgdmVyc2lvbklkTWFya2VyOiB1bmRlZmluZWQsXG4gIH1cbiAgbGV0IGlzVHJ1bmNhdGVkID0gZmFsc2VcbiAgbGV0IG5leHRNYXJrZXIsIG5leHRWZXJzaW9uS2V5TWFya2VyXG4gIGNvbnN0IHhtbG9iaiA9IGZ4cFdpdGhvdXROdW1QYXJzZXIucGFyc2UoeG1sKVxuXG4gIGNvbnN0IHBhcnNlQ29tbW9uUHJlZml4ZXNFbnRpdHkgPSAoY29tbW9uUHJlZml4RW50cnk6IENvbW1vblByZWZpeFtdKSA9PiB7XG4gICAgaWYgKGNvbW1vblByZWZpeEVudHJ5KSB7XG4gICAgICB0b0FycmF5KGNvbW1vblByZWZpeEVudHJ5KS5mb3JFYWNoKChjb21tb25QcmVmaXgpID0+IHtcbiAgICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IHByZWZpeDogc2FuaXRpemVPYmplY3RLZXkodG9BcnJheShjb21tb25QcmVmaXguUHJlZml4KVswXSB8fCAnJyksIHNpemU6IDAgfSlcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgY29uc3QgbGlzdEJ1Y2tldFJlc3VsdDogTGlzdEJ1Y2tldFJlc3VsdFYxID0geG1sb2JqLkxpc3RCdWNrZXRSZXN1bHRcbiAgY29uc3QgbGlzdFZlcnNpb25zUmVzdWx0OiBMaXN0QnVja2V0UmVzdWx0VjEgPSB4bWxvYmouTGlzdFZlcnNpb25zUmVzdWx0XG5cbiAgaWYgKGxpc3RCdWNrZXRSZXN1bHQpIHtcbiAgICBpZiAobGlzdEJ1Y2tldFJlc3VsdC5Jc1RydW5jYXRlZCkge1xuICAgICAgaXNUcnVuY2F0ZWQgPSBsaXN0QnVja2V0UmVzdWx0LklzVHJ1bmNhdGVkXG4gICAgfVxuICAgIGlmIChsaXN0QnVja2V0UmVzdWx0LkNvbnRlbnRzKSB7XG4gICAgICB0b0FycmF5KGxpc3RCdWNrZXRSZXN1bHQuQ29udGVudHMpLmZvckVhY2goKGNvbnRlbnQpID0+IHtcbiAgICAgICAgY29uc3QgbmFtZSA9IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXkoY29udGVudC5LZXkpWzBdIHx8ICcnKVxuICAgICAgICBjb25zdCBsYXN0TW9kaWZpZWQgPSBuZXcgRGF0ZSh0b0FycmF5KGNvbnRlbnQuTGFzdE1vZGlmaWVkKVswXSB8fCAnJylcbiAgICAgICAgY29uc3QgZXRhZyA9IHNhbml0aXplRVRhZyh0b0FycmF5KGNvbnRlbnQuRVRhZylbMF0gfHwgJycpXG4gICAgICAgIGNvbnN0IHNpemUgPSBzYW5pdGl6ZVNpemUoY29udGVudC5TaXplIHx8ICcnKVxuICAgICAgICByZXN1bHQub2JqZWN0cy5wdXNoKHsgbmFtZSwgbGFzdE1vZGlmaWVkLCBldGFnLCBzaXplIH0pXG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmIChsaXN0QnVja2V0UmVzdWx0Lk1hcmtlcikge1xuICAgICAgbmV4dE1hcmtlciA9IGxpc3RCdWNrZXRSZXN1bHQuTWFya2VyXG4gICAgfSBlbHNlIGlmIChpc1RydW5jYXRlZCAmJiByZXN1bHQub2JqZWN0cy5sZW5ndGggPiAwKSB7XG4gICAgICBuZXh0TWFya2VyID0gcmVzdWx0Lm9iamVjdHNbcmVzdWx0Lm9iamVjdHMubGVuZ3RoIC0gMV0/Lm5hbWVcbiAgICB9XG4gICAgaWYgKGxpc3RCdWNrZXRSZXN1bHQuQ29tbW9uUHJlZml4ZXMpIHtcbiAgICAgIHBhcnNlQ29tbW9uUHJlZml4ZXNFbnRpdHkobGlzdEJ1Y2tldFJlc3VsdC5Db21tb25QcmVmaXhlcylcbiAgICB9XG4gIH1cblxuICBpZiAobGlzdFZlcnNpb25zUmVzdWx0KSB7XG4gICAgaWYgKGxpc3RWZXJzaW9uc1Jlc3VsdC5Jc1RydW5jYXRlZCkge1xuICAgICAgaXNUcnVuY2F0ZWQgPSBsaXN0VmVyc2lvbnNSZXN1bHQuSXNUcnVuY2F0ZWRcbiAgICB9XG5cbiAgICBpZiAobGlzdFZlcnNpb25zUmVzdWx0LlZlcnNpb24pIHtcbiAgICAgIHRvQXJyYXkobGlzdFZlcnNpb25zUmVzdWx0LlZlcnNpb24pLmZvckVhY2goKGNvbnRlbnQpID0+IHtcbiAgICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaChmb3JtYXRPYmpJbmZvKGNvbnRlbnQpKVxuICAgICAgfSlcbiAgICB9XG4gICAgaWYgKGxpc3RWZXJzaW9uc1Jlc3VsdC5EZWxldGVNYXJrZXIpIHtcbiAgICAgIHRvQXJyYXkobGlzdFZlcnNpb25zUmVzdWx0LkRlbGV0ZU1hcmtlcikuZm9yRWFjaCgoY29udGVudCkgPT4ge1xuICAgICAgICByZXN1bHQub2JqZWN0cy5wdXNoKGZvcm1hdE9iakluZm8oY29udGVudCwgeyBJc0RlbGV0ZU1hcmtlcjogdHJ1ZSB9KSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKGxpc3RWZXJzaW9uc1Jlc3VsdC5OZXh0S2V5TWFya2VyKSB7XG4gICAgICBuZXh0VmVyc2lvbktleU1hcmtlciA9IGxpc3RWZXJzaW9uc1Jlc3VsdC5OZXh0S2V5TWFya2VyXG4gICAgfVxuICAgIGlmIChsaXN0VmVyc2lvbnNSZXN1bHQuTmV4dFZlcnNpb25JZE1hcmtlcikge1xuICAgICAgcmVzdWx0LnZlcnNpb25JZE1hcmtlciA9IGxpc3RWZXJzaW9uc1Jlc3VsdC5OZXh0VmVyc2lvbklkTWFya2VyXG4gICAgfVxuICAgIGlmIChsaXN0VmVyc2lvbnNSZXN1bHQuQ29tbW9uUHJlZml4ZXMpIHtcbiAgICAgIHBhcnNlQ29tbW9uUHJlZml4ZXNFbnRpdHkobGlzdFZlcnNpb25zUmVzdWx0LkNvbW1vblByZWZpeGVzKVxuICAgIH1cbiAgfVxuXG4gIHJlc3VsdC5pc1RydW5jYXRlZCA9IGlzVHJ1bmNhdGVkXG4gIGlmIChpc1RydW5jYXRlZCkge1xuICAgIHJlc3VsdC5uZXh0TWFya2VyID0gbmV4dFZlcnNpb25LZXlNYXJrZXIgfHwgbmV4dE1hcmtlclxuICB9XG4gIHJldHVybiByZXN1bHRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHVwbG9hZFBhcnRQYXJzZXIoeG1sOiBzdHJpbmcpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICBjb25zdCByZXNwRWwgPSB4bWxPYmouQ29weVBhcnRSZXN1bHRcbiAgcmV0dXJuIHJlc3BFbFxufVxuIl0sIm1hcHBpbmdzIjoiQUFHQSxPQUFPQSxLQUFLLE1BQU0sY0FBYztBQUNoQyxTQUFTQyxTQUFTLFFBQVEsaUJBQWlCO0FBRTNDLE9BQU8sS0FBS0MsTUFBTSxNQUFNLGVBQWM7QUFDdEMsU0FBU0MsYUFBYSxRQUFRLGdCQUFlO0FBQzdDLFNBQVNDLFFBQVEsRUFBRUMsUUFBUSxFQUFFQyxjQUFjLEVBQUVDLFlBQVksRUFBRUMsaUJBQWlCLEVBQUVDLFlBQVksRUFBRUMsT0FBTyxRQUFRLGNBQWE7QUFDeEgs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