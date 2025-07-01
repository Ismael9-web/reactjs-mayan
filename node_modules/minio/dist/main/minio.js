"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _exportNames = {
  Client: true,
  CopyConditions: true,
  PostPolicy: true
};
var Stream = _interopRequireWildcard(require("stream"), true);
var _xml2js = require("xml2js");
var errors = _interopRequireWildcard(require("./errors.js"), true);
Object.keys(errors).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === errors[key]) return;
  exports[key] = errors[key];
});
var _callbackify = require("./internal/callbackify.js");
var _client = require("./internal/client.js");
var _copyConditions = require("./internal/copy-conditions.js");
exports.CopyConditions = _copyConditions.CopyConditions;
var _helper = require("./internal/helper.js");
var _postPolicy = require("./internal/post-policy.js");
exports.PostPolicy = _postPolicy.PostPolicy;
var _notification = require("./notification.js");
Object.keys(_notification).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _notification[key]) return;
  exports[key] = _notification[key];
});
var _promisify = require("./promisify.js");
var transformers = _interopRequireWildcard(require("./transformers.js"), true);
var _helpers = require("./helpers.js");
Object.keys(_helpers).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _helpers[key]) return;
  exports[key] = _helpers[key];
});
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

class Client extends _client.TypedClient {
  //
  // __Arguments__
  // * `appName` _string_ - Application name.
  // * `appVersion` _string_ - Application version.

  // listObjectsV2Query - (List Objects V2) - List some or all (up to 1000) of the objects in a bucket.
  //
  // You can use the request parameters as selection criteria to return a subset of the objects in a bucket.
  // request parameters :-
  // * `bucketName` _string_: name of the bucket
  // * `prefix` _string_: Limits the response to keys that begin with the specified prefix.
  // * `continuation-token` _string_: Used to continue iterating over a set of objects.
  // * `delimiter` _string_: A delimiter is a character you use to group keys.
  // * `max-keys` _number_: Sets the maximum number of keys returned in the response body.
  // * `start-after` _string_: Specifies the key to start after when listing objects in a bucket.
  listObjectsV2Query(bucketName, prefix, continuationToken, delimiter, maxKeys, startAfter) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isString)(continuationToken)) {
      throw new TypeError('continuationToken should be of type "string"');
    }
    if (!(0, _helper.isString)(delimiter)) {
      throw new TypeError('delimiter should be of type "string"');
    }
    if (!(0, _helper.isNumber)(maxKeys)) {
      throw new TypeError('maxKeys should be of type "number"');
    }
    if (!(0, _helper.isString)(startAfter)) {
      throw new TypeError('startAfter should be of type "string"');
    }
    var queries = [];

    // Call for listing objects v2 API
    queries.push(`list-type=2`);
    queries.push(`encoding-type=url`);

    // escape every value in query string, except maxKeys
    queries.push(`prefix=${(0, _helper.uriEscape)(prefix)}`);
    queries.push(`delimiter=${(0, _helper.uriEscape)(delimiter)}`);
    if (continuationToken) {
      continuationToken = (0, _helper.uriEscape)(continuationToken);
      queries.push(`continuation-token=${continuationToken}`);
    }
    // Set start-after
    if (startAfter) {
      startAfter = (0, _helper.uriEscape)(startAfter);
      queries.push(`start-after=${startAfter}`);
    }
    // no need to escape maxKeys
    if (maxKeys) {
      if (maxKeys >= 1000) {
        maxKeys = 1000;
      }
      queries.push(`max-keys=${maxKeys}`);
    }
    queries.sort();
    var query = '';
    if (queries.length > 0) {
      query = `${queries.join('&')}`;
    }
    var method = 'GET';
    var transformer = transformers.getListObjectsV2Transformer();
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return transformer.emit('error', e);
      }
      (0, _helper.pipesetup)(response, transformer);
    });
    return transformer;
  }

  // List the objects in the bucket using S3 ListObjects V2
  //
  // __Arguments__
  // * `bucketName` _string_: name of the bucket
  // * `prefix` _string_: the prefix of the objects that should be listed (optional, default `''`)
  // * `recursive` _bool_: `true` indicates recursive style listing and `false` indicates directory style listing delimited by '/'. (optional, default `false`)
  // * `startAfter` _string_: Specifies the key to start after when listing objects in a bucket. (optional, default `''`)
  //
  // __Return Value__
  // * `stream` _Stream_: stream emitting the objects in the bucket, the object is of the format:
  //   * `obj.name` _string_: name of the object
  //   * `obj.prefix` _string_: name of the object prefix
  //   * `obj.size` _number_: size of the object
  //   * `obj.etag` _string_: etag of the object
  //   * `obj.lastModified` _Date_: modified time stamp
  listObjectsV2(bucketName, prefix, recursive, startAfter) {
    if (prefix === undefined) {
      prefix = '';
    }
    if (recursive === undefined) {
      recursive = false;
    }
    if (startAfter === undefined) {
      startAfter = '';
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
    if (!(0, _helper.isString)(startAfter)) {
      throw new TypeError('startAfter should be of type "string"');
    }
    // if recursive is false set delimiter to '/'
    var delimiter = recursive ? '' : '/';
    var continuationToken = '';
    var objects = [];
    var ended = false;
    var readStream = Stream.Readable({
      objectMode: true
    });
    readStream._read = () => {
      // push one object per _read()
      if (objects.length) {
        readStream.push(objects.shift());
        return;
      }
      if (ended) {
        return readStream.push(null);
      }
      // if there are no objects to push do query for the next batch of objects
      this.listObjectsV2Query(bucketName, prefix, continuationToken, delimiter, 1000, startAfter).on('error', e => readStream.emit('error', e)).on('data', result => {
        if (result.isTruncated) {
          continuationToken = result.nextContinuationToken;
        } else {
          ended = true;
        }
        objects = result.objects;
        readStream._read();
      });
    };
    return readStream;
  }

  // Remove all the notification configurations in the S3 provider
  setBucketNotification(bucketName, config, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isObject)(config)) {
      throw new TypeError('notification config should be of type "Object"');
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var method = 'PUT';
    var query = 'notification';
    var builder = new _xml2js.Builder({
      rootName: 'NotificationConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    var payload = builder.buildObject(config);
    this.makeRequest({
      method,
      bucketName,
      query
    }, payload, [200], '', false, cb);
  }
  removeAllBucketNotification(bucketName, cb) {
    this.setBucketNotification(bucketName, new _notification.NotificationConfig(), cb);
  }

  // Return the list of notification configurations stored
  // in the S3 provider
  getBucketNotification(bucketName, cb) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isFunction)(cb)) {
      throw new TypeError('callback should be of type "function"');
    }
    var method = 'GET';
    var query = 'notification';
    this.makeRequest({
      method,
      bucketName,
      query
    }, '', [200], '', true, (e, response) => {
      if (e) {
        return cb(e);
      }
      var transformer = transformers.getBucketNotificationTransformer();
      var bucketNotification;
      (0, _helper.pipesetup)(response, transformer).on('data', result => bucketNotification = result).on('error', e => cb(e)).on('end', () => cb(null, bucketNotification));
    });
  }

  // Listens for bucket notifications. Returns an EventEmitter.
  listenBucketNotification(bucketName, prefix, suffix, events) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix must be of type string');
    }
    if (!(0, _helper.isString)(suffix)) {
      throw new TypeError('suffix must be of type string');
    }
    if (!Array.isArray(events)) {
      throw new TypeError('events must be of type Array');
    }
    let listener = new _notification.NotificationPoller(this, bucketName, prefix, suffix, events);
    listener.start();
    return listener;
  }
}
exports.Client = Client;
Client.prototype.getBucketNotification = (0, _promisify.promisify)(Client.prototype.getBucketNotification);
Client.prototype.setBucketNotification = (0, _promisify.promisify)(Client.prototype.setBucketNotification);
Client.prototype.removeAllBucketNotification = (0, _promisify.promisify)(Client.prototype.removeAllBucketNotification);

// refactored API use promise internally
Client.prototype.makeBucket = (0, _callbackify.callbackify)(Client.prototype.makeBucket);
Client.prototype.bucketExists = (0, _callbackify.callbackify)(Client.prototype.bucketExists);
Client.prototype.removeBucket = (0, _callbackify.callbackify)(Client.prototype.removeBucket);
Client.prototype.listBuckets = (0, _callbackify.callbackify)(Client.prototype.listBuckets);
Client.prototype.getObject = (0, _callbackify.callbackify)(Client.prototype.getObject);
Client.prototype.fGetObject = (0, _callbackify.callbackify)(Client.prototype.fGetObject);
Client.prototype.getPartialObject = (0, _callbackify.callbackify)(Client.prototype.getPartialObject);
Client.prototype.statObject = (0, _callbackify.callbackify)(Client.prototype.statObject);
Client.prototype.putObjectRetention = (0, _callbackify.callbackify)(Client.prototype.putObjectRetention);
Client.prototype.putObject = (0, _callbackify.callbackify)(Client.prototype.putObject);
Client.prototype.fPutObject = (0, _callbackify.callbackify)(Client.prototype.fPutObject);
Client.prototype.removeObject = (0, _callbackify.callbackify)(Client.prototype.removeObject);
Client.prototype.removeBucketReplication = (0, _callbackify.callbackify)(Client.prototype.removeBucketReplication);
Client.prototype.setBucketReplication = (0, _callbackify.callbackify)(Client.prototype.setBucketReplication);
Client.prototype.getBucketReplication = (0, _callbackify.callbackify)(Client.prototype.getBucketReplication);
Client.prototype.getObjectLegalHold = (0, _callbackify.callbackify)(Client.prototype.getObjectLegalHold);
Client.prototype.setObjectLegalHold = (0, _callbackify.callbackify)(Client.prototype.setObjectLegalHold);
Client.prototype.setObjectLockConfig = (0, _callbackify.callbackify)(Client.prototype.setObjectLockConfig);
Client.prototype.getObjectLockConfig = (0, _callbackify.callbackify)(Client.prototype.getObjectLockConfig);
Client.prototype.getBucketPolicy = (0, _callbackify.callbackify)(Client.prototype.getBucketPolicy);
Client.prototype.setBucketPolicy = (0, _callbackify.callbackify)(Client.prototype.setBucketPolicy);
Client.prototype.getBucketTagging = (0, _callbackify.callbackify)(Client.prototype.getBucketTagging);
Client.prototype.getObjectTagging = (0, _callbackify.callbackify)(Client.prototype.getObjectTagging);
Client.prototype.setBucketTagging = (0, _callbackify.callbackify)(Client.prototype.setBucketTagging);
Client.prototype.removeBucketTagging = (0, _callbackify.callbackify)(Client.prototype.removeBucketTagging);
Client.prototype.setObjectTagging = (0, _callbackify.callbackify)(Client.prototype.setObjectTagging);
Client.prototype.removeObjectTagging = (0, _callbackify.callbackify)(Client.prototype.removeObjectTagging);
Client.prototype.getBucketVersioning = (0, _callbackify.callbackify)(Client.prototype.getBucketVersioning);
Client.prototype.setBucketVersioning = (0, _callbackify.callbackify)(Client.prototype.setBucketVersioning);
Client.prototype.selectObjectContent = (0, _callbackify.callbackify)(Client.prototype.selectObjectContent);
Client.prototype.setBucketLifecycle = (0, _callbackify.callbackify)(Client.prototype.setBucketLifecycle);
Client.prototype.getBucketLifecycle = (0, _callbackify.callbackify)(Client.prototype.getBucketLifecycle);
Client.prototype.removeBucketLifecycle = (0, _callbackify.callbackify)(Client.prototype.removeBucketLifecycle);
Client.prototype.setBucketEncryption = (0, _callbackify.callbackify)(Client.prototype.setBucketEncryption);
Client.prototype.getBucketEncryption = (0, _callbackify.callbackify)(Client.prototype.getBucketEncryption);
Client.prototype.removeBucketEncryption = (0, _callbackify.callbackify)(Client.prototype.removeBucketEncryption);
Client.prototype.getObjectRetention = (0, _callbackify.callbackify)(Client.prototype.getObjectRetention);
Client.prototype.removeObjects = (0, _callbackify.callbackify)(Client.prototype.removeObjects);
Client.prototype.removeIncompleteUpload = (0, _callbackify.callbackify)(Client.prototype.removeIncompleteUpload);
Client.prototype.copyObject = (0, _callbackify.callbackify)(Client.prototype.copyObject);
Client.prototype.composeObject = (0, _callbackify.callbackify)(Client.prototype.composeObject);
Client.prototype.presignedUrl = (0, _callbackify.callbackify)(Client.prototype.presignedUrl);
Client.prototype.presignedGetObject = (0, _callbackify.callbackify)(Client.prototype.presignedGetObject);
Client.prototype.presignedPutObject = (0, _callbackify.callbackify)(Client.prototype.presignedPutObject);
Client.prototype.presignedPostPolicy = (0, _callbackify.callbackify)(Client.prototype.presignedPostPolicy);
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJTdHJlYW0iLCJfaW50ZXJvcFJlcXVpcmVXaWxkY2FyZCIsInJlcXVpcmUiLCJfeG1sMmpzIiwiZXJyb3JzIiwiT2JqZWN0Iiwia2V5cyIsImZvckVhY2giLCJrZXkiLCJwcm90b3R5cGUiLCJoYXNPd25Qcm9wZXJ0eSIsImNhbGwiLCJfZXhwb3J0TmFtZXMiLCJleHBvcnRzIiwiX2NhbGxiYWNraWZ5IiwiX2NsaWVudCIsIl9jb3B5Q29uZGl0aW9ucyIsIkNvcHlDb25kaXRpb25zIiwiX2hlbHBlciIsIl9wb3N0UG9saWN5IiwiUG9zdFBvbGljeSIsIl9ub3RpZmljYXRpb24iLCJfcHJvbWlzaWZ5IiwidHJhbnNmb3JtZXJzIiwiX2hlbHBlcnMiLCJfZ2V0UmVxdWlyZVdpbGRjYXJkQ2FjaGUiLCJub2RlSW50ZXJvcCIsIldlYWtNYXAiLCJjYWNoZUJhYmVsSW50ZXJvcCIsImNhY2hlTm9kZUludGVyb3AiLCJvYmoiLCJfX2VzTW9kdWxlIiwiZGVmYXVsdCIsImNhY2hlIiwiaGFzIiwiZ2V0IiwibmV3T2JqIiwiaGFzUHJvcGVydHlEZXNjcmlwdG9yIiwiZGVmaW5lUHJvcGVydHkiLCJnZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IiLCJkZXNjIiwic2V0IiwiQ2xpZW50IiwiVHlwZWRDbGllbnQiLCJsaXN0T2JqZWN0c1YyUXVlcnkiLCJidWNrZXROYW1lIiwicHJlZml4IiwiY29udGludWF0aW9uVG9rZW4iLCJkZWxpbWl0ZXIiLCJtYXhLZXlzIiwic3RhcnRBZnRlciIsImlzVmFsaWRCdWNrZXROYW1lIiwiSW52YWxpZEJ1Y2tldE5hbWVFcnJvciIsImlzU3RyaW5nIiwiVHlwZUVycm9yIiwiaXNOdW1iZXIiLCJxdWVyaWVzIiwicHVzaCIsInVyaUVzY2FwZSIsInNvcnQiLCJxdWVyeSIsImxlbmd0aCIsImpvaW4iLCJtZXRob2QiLCJ0cmFuc2Zvcm1lciIsImdldExpc3RPYmplY3RzVjJUcmFuc2Zvcm1lciIsIm1ha2VSZXF1ZXN0IiwiZSIsInJlc3BvbnNlIiwiZW1pdCIsInBpcGVzZXR1cCIsImxpc3RPYmplY3RzVjIiLCJyZWN1cnNpdmUiLCJ1bmRlZmluZWQiLCJpc1ZhbGlkUHJlZml4IiwiSW52YWxpZFByZWZpeEVycm9yIiwiaXNCb29sZWFuIiwib2JqZWN0cyIsImVuZGVkIiwicmVhZFN0cmVhbSIsIlJlYWRhYmxlIiwib2JqZWN0TW9kZSIsIl9yZWFkIiwic2hpZnQiLCJvbiIsInJlc3VsdCIsImlzVHJ1bmNhdGVkIiwibmV4dENvbnRpbnVhdGlvblRva2VuIiwic2V0QnVja2V0Tm90aWZpY2F0aW9uIiwiY29uZmlnIiwiY2IiLCJpc09iamVjdCIsImlzRnVuY3Rpb24iLCJidWlsZGVyIiwieG1sMmpzIiwiQnVpbGRlciIsInJvb3ROYW1lIiwicmVuZGVyT3B0cyIsInByZXR0eSIsImhlYWRsZXNzIiwicGF5bG9hZCIsImJ1aWxkT2JqZWN0IiwicmVtb3ZlQWxsQnVja2V0Tm90aWZpY2F0aW9uIiwiTm90aWZpY2F0aW9uQ29uZmlnIiwiZ2V0QnVja2V0Tm90aWZpY2F0aW9uIiwiZ2V0QnVja2V0Tm90aWZpY2F0aW9uVHJhbnNmb3JtZXIiLCJidWNrZXROb3RpZmljYXRpb24iLCJsaXN0ZW5CdWNrZXROb3RpZmljYXRpb24iLCJzdWZmaXgiLCJldmVudHMiLCJBcnJheSIsImlzQXJyYXkiLCJsaXN0ZW5lciIsIk5vdGlmaWNhdGlvblBvbGxlciIsInN0YXJ0IiwicHJvbWlzaWZ5IiwibWFrZUJ1Y2tldCIsImNhbGxiYWNraWZ5IiwiYnVja2V0RXhpc3RzIiwicmVtb3ZlQnVja2V0IiwibGlzdEJ1Y2tldHMiLCJnZXRPYmplY3QiLCJmR2V0T2JqZWN0IiwiZ2V0UGFydGlhbE9iamVjdCIsInN0YXRPYmplY3QiLCJwdXRPYmplY3RSZXRlbnRpb24iLCJwdXRPYmplY3QiLCJmUHV0T2JqZWN0IiwicmVtb3ZlT2JqZWN0IiwicmVtb3ZlQnVja2V0UmVwbGljYXRpb24iLCJzZXRCdWNrZXRSZXBsaWNhdGlvbiIsImdldEJ1Y2tldFJlcGxpY2F0aW9uIiwiZ2V0T2JqZWN0TGVnYWxIb2xkIiwic2V0T2JqZWN0TGVnYWxIb2xkIiwic2V0T2JqZWN0TG9ja0NvbmZpZyIsImdldE9iamVjdExvY2tDb25maWciLCJnZXRCdWNrZXRQb2xpY3kiLCJzZXRCdWNrZXRQb2xpY3kiLCJnZXRCdWNrZXRUYWdnaW5nIiwiZ2V0T2JqZWN0VGFnZ2luZyIsInNldEJ1Y2tldFRhZ2dpbmciLCJyZW1vdmVCdWNrZXRUYWdnaW5nIiwic2V0T2JqZWN0VGFnZ2luZyIsInJlbW92ZU9iamVjdFRhZ2dpbmciLCJnZXRCdWNrZXRWZXJzaW9uaW5nIiwic2V0QnVja2V0VmVyc2lvbmluZyIsInNlbGVjdE9iamVjdENvbnRlbnQiLCJzZXRCdWNrZXRMaWZlY3ljbGUiLCJnZXRCdWNrZXRMaWZlY3ljbGUiLCJyZW1vdmVCdWNrZXRMaWZlY3ljbGUiLCJzZXRCdWNrZXRFbmNyeXB0aW9uIiwiZ2V0QnVja2V0RW5jcnlwdGlvbiIsInJlbW92ZUJ1Y2tldEVuY3J5cHRpb24iLCJnZXRPYmplY3RSZXRlbnRpb24iLCJyZW1vdmVPYmplY3RzIiwicmVtb3ZlSW5jb21wbGV0ZVVwbG9hZCIsImNvcHlPYmplY3QiLCJjb21wb3NlT2JqZWN0IiwicHJlc2lnbmVkVXJsIiwicHJlc2lnbmVkR2V0T2JqZWN0IiwicHJlc2lnbmVkUHV0T2JqZWN0IiwicHJlc2lnbmVkUG9zdFBvbGljeSJdLCJzb3VyY2VzIjpbIm1pbmlvLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qXG4gKiBNaW5JTyBKYXZhc2NyaXB0IExpYnJhcnkgZm9yIEFtYXpvbiBTMyBDb21wYXRpYmxlIENsb3VkIFN0b3JhZ2UsIChDKSAyMDE1IE1pbklPLCBJbmMuXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICovXG5cbmltcG9ydCAqIGFzIFN0cmVhbSBmcm9tICdub2RlOnN0cmVhbSdcblxuaW1wb3J0IHhtbDJqcyBmcm9tICd4bWwyanMnXG5cbmltcG9ydCAqIGFzIGVycm9ycyBmcm9tICcuL2Vycm9ycy50cydcbmltcG9ydCB7IGNhbGxiYWNraWZ5IH0gZnJvbSAnLi9pbnRlcm5hbC9jYWxsYmFja2lmeS5qcydcbmltcG9ydCB7IFR5cGVkQ2xpZW50IH0gZnJvbSAnLi9pbnRlcm5hbC9jbGllbnQudHMnXG5pbXBvcnQgeyBDb3B5Q29uZGl0aW9ucyB9IGZyb20gJy4vaW50ZXJuYWwvY29weS1jb25kaXRpb25zLnRzJ1xuaW1wb3J0IHtcbiAgaXNCb29sZWFuLFxuICBpc0Z1bmN0aW9uLFxuICBpc051bWJlcixcbiAgaXNPYmplY3QsXG4gIGlzU3RyaW5nLFxuICBpc1ZhbGlkQnVja2V0TmFtZSxcbiAgaXNWYWxpZFByZWZpeCxcbiAgcGlwZXNldHVwLFxuICB1cmlFc2NhcGUsXG59IGZyb20gJy4vaW50ZXJuYWwvaGVscGVyLnRzJ1xuaW1wb3J0IHsgUG9zdFBvbGljeSB9IGZyb20gJy4vaW50ZXJuYWwvcG9zdC1wb2xpY3kudHMnXG5pbXBvcnQgeyBOb3RpZmljYXRpb25Db25maWcsIE5vdGlmaWNhdGlvblBvbGxlciB9IGZyb20gJy4vbm90aWZpY2F0aW9uLnRzJ1xuaW1wb3J0IHsgcHJvbWlzaWZ5IH0gZnJvbSAnLi9wcm9taXNpZnkuanMnXG5pbXBvcnQgKiBhcyB0cmFuc2Zvcm1lcnMgZnJvbSAnLi90cmFuc2Zvcm1lcnMuanMnXG5cbmV4cG9ydCAqIGZyb20gJy4vZXJyb3JzLnRzJ1xuZXhwb3J0ICogZnJvbSAnLi9oZWxwZXJzLnRzJ1xuZXhwb3J0ICogZnJvbSAnLi9ub3RpZmljYXRpb24udHMnXG5leHBvcnQgeyBDb3B5Q29uZGl0aW9ucywgUG9zdFBvbGljeSB9XG5cbmV4cG9ydCBjbGFzcyBDbGllbnQgZXh0ZW5kcyBUeXBlZENsaWVudCB7XG4gIC8vXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgYXBwTmFtZWAgX3N0cmluZ18gLSBBcHBsaWNhdGlvbiBuYW1lLlxuICAvLyAqIGBhcHBWZXJzaW9uYCBfc3RyaW5nXyAtIEFwcGxpY2F0aW9uIHZlcnNpb24uXG5cbiAgLy8gbGlzdE9iamVjdHNWMlF1ZXJ5IC0gKExpc3QgT2JqZWN0cyBWMikgLSBMaXN0IHNvbWUgb3IgYWxsICh1cCB0byAxMDAwKSBvZiB0aGUgb2JqZWN0cyBpbiBhIGJ1Y2tldC5cbiAgLy9cbiAgLy8gWW91IGNhbiB1c2UgdGhlIHJlcXVlc3QgcGFyYW1ldGVycyBhcyBzZWxlY3Rpb24gY3JpdGVyaWEgdG8gcmV0dXJuIGEgc3Vic2V0IG9mIHRoZSBvYmplY3RzIGluIGEgYnVja2V0LlxuICAvLyByZXF1ZXN0IHBhcmFtZXRlcnMgOi1cbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGBwcmVmaXhgIF9zdHJpbmdfOiBMaW1pdHMgdGhlIHJlc3BvbnNlIHRvIGtleXMgdGhhdCBiZWdpbiB3aXRoIHRoZSBzcGVjaWZpZWQgcHJlZml4LlxuICAvLyAqIGBjb250aW51YXRpb24tdG9rZW5gIF9zdHJpbmdfOiBVc2VkIHRvIGNvbnRpbnVlIGl0ZXJhdGluZyBvdmVyIGEgc2V0IG9mIG9iamVjdHMuXG4gIC8vICogYGRlbGltaXRlcmAgX3N0cmluZ186IEEgZGVsaW1pdGVyIGlzIGEgY2hhcmFjdGVyIHlvdSB1c2UgdG8gZ3JvdXAga2V5cy5cbiAgLy8gKiBgbWF4LWtleXNgIF9udW1iZXJfOiBTZXRzIHRoZSBtYXhpbXVtIG51bWJlciBvZiBrZXlzIHJldHVybmVkIGluIHRoZSByZXNwb25zZSBib2R5LlxuICAvLyAqIGBzdGFydC1hZnRlcmAgX3N0cmluZ186IFNwZWNpZmllcyB0aGUga2V5IHRvIHN0YXJ0IGFmdGVyIHdoZW4gbGlzdGluZyBvYmplY3RzIGluIGEgYnVja2V0LlxuICBsaXN0T2JqZWN0c1YyUXVlcnkoYnVja2V0TmFtZSwgcHJlZml4LCBjb250aW51YXRpb25Ub2tlbiwgZGVsaW1pdGVyLCBtYXhLZXlzLCBzdGFydEFmdGVyKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwcmVmaXggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoY29udGludWF0aW9uVG9rZW4pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjb250aW51YXRpb25Ub2tlbiBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhkZWxpbWl0ZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdkZWxpbWl0ZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNOdW1iZXIobWF4S2V5cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21heEtleXMgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoc3RhcnRBZnRlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N0YXJ0QWZ0ZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIHZhciBxdWVyaWVzID0gW11cblxuICAgIC8vIENhbGwgZm9yIGxpc3Rpbmcgb2JqZWN0cyB2MiBBUElcbiAgICBxdWVyaWVzLnB1c2goYGxpc3QtdHlwZT0yYClcbiAgICBxdWVyaWVzLnB1c2goYGVuY29kaW5nLXR5cGU9dXJsYClcblxuICAgIC8vIGVzY2FwZSBldmVyeSB2YWx1ZSBpbiBxdWVyeSBzdHJpbmcsIGV4Y2VwdCBtYXhLZXlzXG4gICAgcXVlcmllcy5wdXNoKGBwcmVmaXg9JHt1cmlFc2NhcGUocHJlZml4KX1gKVxuICAgIHF1ZXJpZXMucHVzaChgZGVsaW1pdGVyPSR7dXJpRXNjYXBlKGRlbGltaXRlcil9YClcblxuICAgIGlmIChjb250aW51YXRpb25Ub2tlbikge1xuICAgICAgY29udGludWF0aW9uVG9rZW4gPSB1cmlFc2NhcGUoY29udGludWF0aW9uVG9rZW4pXG4gICAgICBxdWVyaWVzLnB1c2goYGNvbnRpbnVhdGlvbi10b2tlbj0ke2NvbnRpbnVhdGlvblRva2VufWApXG4gICAgfVxuICAgIC8vIFNldCBzdGFydC1hZnRlclxuICAgIGlmIChzdGFydEFmdGVyKSB7XG4gICAgICBzdGFydEFmdGVyID0gdXJpRXNjYXBlKHN0YXJ0QWZ0ZXIpXG4gICAgICBxdWVyaWVzLnB1c2goYHN0YXJ0LWFmdGVyPSR7c3RhcnRBZnRlcn1gKVxuICAgIH1cbiAgICAvLyBubyBuZWVkIHRvIGVzY2FwZSBtYXhLZXlzXG4gICAgaWYgKG1heEtleXMpIHtcbiAgICAgIGlmIChtYXhLZXlzID49IDEwMDApIHtcbiAgICAgICAgbWF4S2V5cyA9IDEwMDBcbiAgICAgIH1cbiAgICAgIHF1ZXJpZXMucHVzaChgbWF4LWtleXM9JHttYXhLZXlzfWApXG4gICAgfVxuICAgIHF1ZXJpZXMuc29ydCgpXG4gICAgdmFyIHF1ZXJ5ID0gJydcbiAgICBpZiAocXVlcmllcy5sZW5ndGggPiAwKSB7XG4gICAgICBxdWVyeSA9IGAke3F1ZXJpZXMuam9pbignJicpfWBcbiAgICB9XG4gICAgdmFyIG1ldGhvZCA9ICdHRVQnXG4gICAgdmFyIHRyYW5zZm9ybWVyID0gdHJhbnNmb3JtZXJzLmdldExpc3RPYmplY3RzVjJUcmFuc2Zvcm1lcigpXG4gICAgdGhpcy5tYWtlUmVxdWVzdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDBdLCAnJywgdHJ1ZSwgKGUsIHJlc3BvbnNlKSA9PiB7XG4gICAgICBpZiAoZSkge1xuICAgICAgICByZXR1cm4gdHJhbnNmb3JtZXIuZW1pdCgnZXJyb3InLCBlKVxuICAgICAgfVxuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcilcbiAgICB9KVxuICAgIHJldHVybiB0cmFuc2Zvcm1lclxuICB9XG5cbiAgLy8gTGlzdCB0aGUgb2JqZWN0cyBpbiB0aGUgYnVja2V0IHVzaW5nIFMzIExpc3RPYmplY3RzIFYyXG4gIC8vXG4gIC8vIF9fQXJndW1lbnRzX19cbiAgLy8gKiBgYnVja2V0TmFtZWAgX3N0cmluZ186IG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAvLyAqIGBwcmVmaXhgIF9zdHJpbmdfOiB0aGUgcHJlZml4IG9mIHRoZSBvYmplY3RzIHRoYXQgc2hvdWxkIGJlIGxpc3RlZCAob3B0aW9uYWwsIGRlZmF1bHQgYCcnYClcbiAgLy8gKiBgcmVjdXJzaXZlYCBfYm9vbF86IGB0cnVlYCBpbmRpY2F0ZXMgcmVjdXJzaXZlIHN0eWxlIGxpc3RpbmcgYW5kIGBmYWxzZWAgaW5kaWNhdGVzIGRpcmVjdG9yeSBzdHlsZSBsaXN0aW5nIGRlbGltaXRlZCBieSAnLycuIChvcHRpb25hbCwgZGVmYXVsdCBgZmFsc2VgKVxuICAvLyAqIGBzdGFydEFmdGVyYCBfc3RyaW5nXzogU3BlY2lmaWVzIHRoZSBrZXkgdG8gc3RhcnQgYWZ0ZXIgd2hlbiBsaXN0aW5nIG9iamVjdHMgaW4gYSBidWNrZXQuIChvcHRpb25hbCwgZGVmYXVsdCBgJydgKVxuICAvL1xuICAvLyBfX1JldHVybiBWYWx1ZV9fXG4gIC8vICogYHN0cmVhbWAgX1N0cmVhbV86IHN0cmVhbSBlbWl0dGluZyB0aGUgb2JqZWN0cyBpbiB0aGUgYnVja2V0LCB0aGUgb2JqZWN0IGlzIG9mIHRoZSBmb3JtYXQ6XG4gIC8vICAgKiBgb2JqLm5hbWVgIF9zdHJpbmdfOiBuYW1lIG9mIHRoZSBvYmplY3RcbiAgLy8gICAqIGBvYmoucHJlZml4YCBfc3RyaW5nXzogbmFtZSBvZiB0aGUgb2JqZWN0IHByZWZpeFxuICAvLyAgICogYG9iai5zaXplYCBfbnVtYmVyXzogc2l6ZSBvZiB0aGUgb2JqZWN0XG4gIC8vICAgKiBgb2JqLmV0YWdgIF9zdHJpbmdfOiBldGFnIG9mIHRoZSBvYmplY3RcbiAgLy8gICAqIGBvYmoubGFzdE1vZGlmaWVkYCBfRGF0ZV86IG1vZGlmaWVkIHRpbWUgc3RhbXBcbiAgbGlzdE9iamVjdHNWMihidWNrZXROYW1lLCBwcmVmaXgsIHJlY3Vyc2l2ZSwgc3RhcnRBZnRlcikge1xuICAgIGlmIChwcmVmaXggPT09IHVuZGVmaW5lZCkge1xuICAgICAgcHJlZml4ID0gJydcbiAgICB9XG4gICAgaWYgKHJlY3Vyc2l2ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZWN1cnNpdmUgPSBmYWxzZVxuICAgIH1cbiAgICBpZiAoc3RhcnRBZnRlciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBzdGFydEFmdGVyID0gJydcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkUHJlZml4KHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFByZWZpeEVycm9yKGBJbnZhbGlkIHByZWZpeCA6ICR7cHJlZml4fWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzQm9vbGVhbihyZWN1cnNpdmUpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWN1cnNpdmUgc2hvdWxkIGJlIG9mIHR5cGUgXCJib29sZWFuXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHN0YXJ0QWZ0ZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzdGFydEFmdGVyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICAvLyBpZiByZWN1cnNpdmUgaXMgZmFsc2Ugc2V0IGRlbGltaXRlciB0byAnLydcbiAgICB2YXIgZGVsaW1pdGVyID0gcmVjdXJzaXZlID8gJycgOiAnLydcbiAgICB2YXIgY29udGludWF0aW9uVG9rZW4gPSAnJ1xuICAgIHZhciBvYmplY3RzID0gW11cbiAgICB2YXIgZW5kZWQgPSBmYWxzZVxuICAgIHZhciByZWFkU3RyZWFtID0gU3RyZWFtLlJlYWRhYmxlKHsgb2JqZWN0TW9kZTogdHJ1ZSB9KVxuICAgIHJlYWRTdHJlYW0uX3JlYWQgPSAoKSA9PiB7XG4gICAgICAvLyBwdXNoIG9uZSBvYmplY3QgcGVyIF9yZWFkKClcbiAgICAgIGlmIChvYmplY3RzLmxlbmd0aCkge1xuICAgICAgICByZWFkU3RyZWFtLnB1c2gob2JqZWN0cy5zaGlmdCgpKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICAgIGlmIChlbmRlZCkge1xuICAgICAgICByZXR1cm4gcmVhZFN0cmVhbS5wdXNoKG51bGwpXG4gICAgICB9XG4gICAgICAvLyBpZiB0aGVyZSBhcmUgbm8gb2JqZWN0cyB0byBwdXNoIGRvIHF1ZXJ5IGZvciB0aGUgbmV4dCBiYXRjaCBvZiBvYmplY3RzXG4gICAgICB0aGlzLmxpc3RPYmplY3RzVjJRdWVyeShidWNrZXROYW1lLCBwcmVmaXgsIGNvbnRpbnVhdGlvblRva2VuLCBkZWxpbWl0ZXIsIDEwMDAsIHN0YXJ0QWZ0ZXIpXG4gICAgICAgIC5vbignZXJyb3InLCAoZSkgPT4gcmVhZFN0cmVhbS5lbWl0KCdlcnJvcicsIGUpKVxuICAgICAgICAub24oJ2RhdGEnLCAocmVzdWx0KSA9PiB7XG4gICAgICAgICAgaWYgKHJlc3VsdC5pc1RydW5jYXRlZCkge1xuICAgICAgICAgICAgY29udGludWF0aW9uVG9rZW4gPSByZXN1bHQubmV4dENvbnRpbnVhdGlvblRva2VuXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGVuZGVkID0gdHJ1ZVxuICAgICAgICAgIH1cbiAgICAgICAgICBvYmplY3RzID0gcmVzdWx0Lm9iamVjdHNcbiAgICAgICAgICByZWFkU3RyZWFtLl9yZWFkKClcbiAgICAgICAgfSlcbiAgICB9XG4gICAgcmV0dXJuIHJlYWRTdHJlYW1cbiAgfVxuXG4gIC8vIFJlbW92ZSBhbGwgdGhlIG5vdGlmaWNhdGlvbiBjb25maWd1cmF0aW9ucyBpbiB0aGUgUzMgcHJvdmlkZXJcbiAgc2V0QnVja2V0Tm90aWZpY2F0aW9uKGJ1Y2tldE5hbWUsIGNvbmZpZywgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KGNvbmZpZykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ25vdGlmaWNhdGlvbiBjb25maWcgc2hvdWxkIGJlIG9mIHR5cGUgXCJPYmplY3RcIicpXG4gICAgfVxuICAgIGlmICghaXNGdW5jdGlvbihjYikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIHNob3VsZCBiZSBvZiB0eXBlIFwiZnVuY3Rpb25cIicpXG4gICAgfVxuICAgIHZhciBtZXRob2QgPSAnUFVUJ1xuICAgIHZhciBxdWVyeSA9ICdub3RpZmljYXRpb24nXG4gICAgdmFyIGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xuICAgICAgcm9vdE5hbWU6ICdOb3RpZmljYXRpb25Db25maWd1cmF0aW9uJyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICB2YXIgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoY29uZmlnKVxuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sIHBheWxvYWQsIFsyMDBdLCAnJywgZmFsc2UsIGNiKVxuICB9XG5cbiAgcmVtb3ZlQWxsQnVja2V0Tm90aWZpY2F0aW9uKGJ1Y2tldE5hbWUsIGNiKSB7XG4gICAgdGhpcy5zZXRCdWNrZXROb3RpZmljYXRpb24oYnVja2V0TmFtZSwgbmV3IE5vdGlmaWNhdGlvbkNvbmZpZygpLCBjYilcbiAgfVxuXG4gIC8vIFJldHVybiB0aGUgbGlzdCBvZiBub3RpZmljYXRpb24gY29uZmlndXJhdGlvbnMgc3RvcmVkXG4gIC8vIGluIHRoZSBTMyBwcm92aWRlclxuICBnZXRCdWNrZXROb3RpZmljYXRpb24oYnVja2V0TmFtZSwgY2IpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzRnVuY3Rpb24oY2IpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICAgIH1cbiAgICB2YXIgbWV0aG9kID0gJ0dFVCdcbiAgICB2YXIgcXVlcnkgPSAnbm90aWZpY2F0aW9uJ1xuICAgIHRoaXMubWFrZVJlcXVlc3QoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwXSwgJycsIHRydWUsIChlLCByZXNwb25zZSkgPT4ge1xuICAgICAgaWYgKGUpIHtcbiAgICAgICAgcmV0dXJuIGNiKGUpXG4gICAgICB9XG4gICAgICB2YXIgdHJhbnNmb3JtZXIgPSB0cmFuc2Zvcm1lcnMuZ2V0QnVja2V0Tm90aWZpY2F0aW9uVHJhbnNmb3JtZXIoKVxuICAgICAgdmFyIGJ1Y2tldE5vdGlmaWNhdGlvblxuICAgICAgcGlwZXNldHVwKHJlc3BvbnNlLCB0cmFuc2Zvcm1lcilcbiAgICAgICAgLm9uKCdkYXRhJywgKHJlc3VsdCkgPT4gKGJ1Y2tldE5vdGlmaWNhdGlvbiA9IHJlc3VsdCkpXG4gICAgICAgIC5vbignZXJyb3InLCAoZSkgPT4gY2IoZSkpXG4gICAgICAgIC5vbignZW5kJywgKCkgPT4gY2IobnVsbCwgYnVja2V0Tm90aWZpY2F0aW9uKSlcbiAgICB9KVxuICB9XG5cbiAgLy8gTGlzdGVucyBmb3IgYnVja2V0IG5vdGlmaWNhdGlvbnMuIFJldHVybnMgYW4gRXZlbnRFbWl0dGVyLlxuICBsaXN0ZW5CdWNrZXROb3RpZmljYXRpb24oYnVja2V0TmFtZSwgcHJlZml4LCBzdWZmaXgsIGV2ZW50cykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IG11c3QgYmUgb2YgdHlwZSBzdHJpbmcnKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHN1ZmZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N1ZmZpeCBtdXN0IGJlIG9mIHR5cGUgc3RyaW5nJylcbiAgICB9XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGV2ZW50cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2V2ZW50cyBtdXN0IGJlIG9mIHR5cGUgQXJyYXknKVxuICAgIH1cbiAgICBsZXQgbGlzdGVuZXIgPSBuZXcgTm90aWZpY2F0aW9uUG9sbGVyKHRoaXMsIGJ1Y2tldE5hbWUsIHByZWZpeCwgc3VmZml4LCBldmVudHMpXG4gICAgbGlzdGVuZXIuc3RhcnQoKVxuXG4gICAgcmV0dXJuIGxpc3RlbmVyXG4gIH1cbn1cblxuQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXROb3RpZmljYXRpb24gPSBwcm9taXNpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXROb3RpZmljYXRpb24pXG5DbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldE5vdGlmaWNhdGlvbiA9IHByb21pc2lmeShDbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldE5vdGlmaWNhdGlvbilcbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlQWxsQnVja2V0Tm90aWZpY2F0aW9uID0gcHJvbWlzaWZ5KENsaWVudC5wcm90b3R5cGUucmVtb3ZlQWxsQnVja2V0Tm90aWZpY2F0aW9uKVxuXG4vLyByZWZhY3RvcmVkIEFQSSB1c2UgcHJvbWlzZSBpbnRlcm5hbGx5XG5DbGllbnQucHJvdG90eXBlLm1ha2VCdWNrZXQgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLm1ha2VCdWNrZXQpXG5DbGllbnQucHJvdG90eXBlLmJ1Y2tldEV4aXN0cyA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuYnVja2V0RXhpc3RzKVxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXQgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldClcbkNsaWVudC5wcm90b3R5cGUubGlzdEJ1Y2tldHMgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmxpc3RCdWNrZXRzKVxuXG5DbGllbnQucHJvdG90eXBlLmdldE9iamVjdCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0KVxuQ2xpZW50LnByb3RvdHlwZS5mR2V0T2JqZWN0ID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5mR2V0T2JqZWN0KVxuQ2xpZW50LnByb3RvdHlwZS5nZXRQYXJ0aWFsT2JqZWN0ID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRQYXJ0aWFsT2JqZWN0KVxuQ2xpZW50LnByb3RvdHlwZS5zdGF0T2JqZWN0ID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5zdGF0T2JqZWN0KVxuQ2xpZW50LnByb3RvdHlwZS5wdXRPYmplY3RSZXRlbnRpb24gPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnB1dE9iamVjdFJldGVudGlvbilcbkNsaWVudC5wcm90b3R5cGUucHV0T2JqZWN0ID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5wdXRPYmplY3QpXG5DbGllbnQucHJvdG90eXBlLmZQdXRPYmplY3QgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmZQdXRPYmplY3QpXG5DbGllbnQucHJvdG90eXBlLnJlbW92ZU9iamVjdCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUucmVtb3ZlT2JqZWN0KVxuXG5DbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXRSZXBsaWNhdGlvbilcbkNsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0UmVwbGljYXRpb24gPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldFJlcGxpY2F0aW9uKVxuQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRSZXBsaWNhdGlvbiA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0QnVja2V0UmVwbGljYXRpb24pXG5DbGllbnQucHJvdG90eXBlLmdldE9iamVjdExlZ2FsSG9sZCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0TGVnYWxIb2xkKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRPYmplY3RMZWdhbEhvbGQgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnNldE9iamVjdExlZ2FsSG9sZClcbkNsaWVudC5wcm90b3R5cGUuc2V0T2JqZWN0TG9ja0NvbmZpZyA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuc2V0T2JqZWN0TG9ja0NvbmZpZylcbkNsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0TG9ja0NvbmZpZyA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuZ2V0T2JqZWN0TG9ja0NvbmZpZylcbkNsaWVudC5wcm90b3R5cGUuZ2V0QnVja2V0UG9saWN5ID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRQb2xpY3kpXG5DbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldFBvbGljeSA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuc2V0QnVja2V0UG9saWN5KVxuQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRUYWdnaW5nID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRUYWdnaW5nKVxuQ2xpZW50LnByb3RvdHlwZS5nZXRPYmplY3RUYWdnaW5nID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRPYmplY3RUYWdnaW5nKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRUYWdnaW5nID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRUYWdnaW5nKVxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXRUYWdnaW5nID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXRUYWdnaW5nKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRPYmplY3RUYWdnaW5nID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5zZXRPYmplY3RUYWdnaW5nKVxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVPYmplY3RUYWdnaW5nID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVPYmplY3RUYWdnaW5nKVxuQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRWZXJzaW9uaW5nID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRWZXJzaW9uaW5nKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRWZXJzaW9uaW5nID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRWZXJzaW9uaW5nKVxuQ2xpZW50LnByb3RvdHlwZS5zZWxlY3RPYmplY3RDb250ZW50ID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5zZWxlY3RPYmplY3RDb250ZW50KVxuQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRMaWZlY3ljbGUgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnNldEJ1Y2tldExpZmVjeWNsZSlcbkNsaWVudC5wcm90b3R5cGUuZ2V0QnVja2V0TGlmZWN5Y2xlID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRMaWZlY3ljbGUpXG5DbGllbnQucHJvdG90eXBlLnJlbW92ZUJ1Y2tldExpZmVjeWNsZSA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUucmVtb3ZlQnVja2V0TGlmZWN5Y2xlKVxuQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRFbmNyeXB0aW9uID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5zZXRCdWNrZXRFbmNyeXB0aW9uKVxuQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRFbmNyeXB0aW9uID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5nZXRCdWNrZXRFbmNyeXB0aW9uKVxuQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXRFbmNyeXB0aW9uID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5yZW1vdmVCdWNrZXRFbmNyeXB0aW9uKVxuQ2xpZW50LnByb3RvdHlwZS5nZXRPYmplY3RSZXRlbnRpb24gPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLmdldE9iamVjdFJldGVudGlvbilcbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlT2JqZWN0cyA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUucmVtb3ZlT2JqZWN0cylcbkNsaWVudC5wcm90b3R5cGUucmVtb3ZlSW5jb21wbGV0ZVVwbG9hZCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUucmVtb3ZlSW5jb21wbGV0ZVVwbG9hZClcbkNsaWVudC5wcm90b3R5cGUuY29weU9iamVjdCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuY29weU9iamVjdClcbkNsaWVudC5wcm90b3R5cGUuY29tcG9zZU9iamVjdCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUuY29tcG9zZU9iamVjdClcbkNsaWVudC5wcm90b3R5cGUucHJlc2lnbmVkVXJsID0gY2FsbGJhY2tpZnkoQ2xpZW50LnByb3RvdHlwZS5wcmVzaWduZWRVcmwpXG5DbGllbnQucHJvdG90eXBlLnByZXNpZ25lZEdldE9iamVjdCA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUucHJlc2lnbmVkR2V0T2JqZWN0KVxuQ2xpZW50LnByb3RvdHlwZS5wcmVzaWduZWRQdXRPYmplY3QgPSBjYWxsYmFja2lmeShDbGllbnQucHJvdG90eXBlLnByZXNpZ25lZFB1dE9iamVjdClcbkNsaWVudC5wcm90b3R5cGUucHJlc2lnbmVkUG9zdFBvbGljeSA9IGNhbGxiYWNraWZ5KENsaWVudC5wcm90b3R5cGUucHJlc2lnbmVkUG9zdFBvbGljeSlcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7OztBQWdCQSxJQUFBQSxNQUFBLEdBQUFDLHVCQUFBLENBQUFDLE9BQUE7QUFFQSxJQUFBQyxPQUFBLEdBQUFELE9BQUE7QUFFQSxJQUFBRSxNQUFBLEdBQUFILHVCQUFBLENBQUFDLE9BQUE7QUFvQkFHLE1BQUEsQ0FBQUMsSUFBQSxDQUFBRixNQUFBLEVBQUFHLE9BQUEsV0FBQUMsR0FBQTtFQUFBLElBQUFBLEdBQUEsa0JBQUFBLEdBQUE7RUFBQSxJQUFBSCxNQUFBLENBQUFJLFNBQUEsQ0FBQUMsY0FBQSxDQUFBQyxJQUFBLENBQUFDLFlBQUEsRUFBQUosR0FBQTtFQUFBLElBQUFBLEdBQUEsSUFBQUssT0FBQSxJQUFBQSxPQUFBLENBQUFMLEdBQUEsTUFBQUosTUFBQSxDQUFBSSxHQUFBO0VBQUFLLE9BQUEsQ0FBQUwsR0FBQSxJQUFBSixNQUFBLENBQUFJLEdBQUE7QUFBQTtBQW5CQSxJQUFBTSxZQUFBLEdBQUFaLE9BQUE7QUFDQSxJQUFBYSxPQUFBLEdBQUFiLE9BQUE7QUFDQSxJQUFBYyxlQUFBLEdBQUFkLE9BQUE7QUFBOERXLE9BQUEsQ0FBQUksY0FBQSxHQUFBRCxlQUFBLENBQUFDLGNBQUE7QUFDOUQsSUFBQUMsT0FBQSxHQUFBaEIsT0FBQTtBQVdBLElBQUFpQixXQUFBLEdBQUFqQixPQUFBO0FBQXNEVyxPQUFBLENBQUFPLFVBQUEsR0FBQUQsV0FBQSxDQUFBQyxVQUFBO0FBQ3RELElBQUFDLGFBQUEsR0FBQW5CLE9BQUE7QUFNQUcsTUFBQSxDQUFBQyxJQUFBLENBQUFlLGFBQUEsRUFBQWQsT0FBQSxXQUFBQyxHQUFBO0VBQUEsSUFBQUEsR0FBQSxrQkFBQUEsR0FBQTtFQUFBLElBQUFILE1BQUEsQ0FBQUksU0FBQSxDQUFBQyxjQUFBLENBQUFDLElBQUEsQ0FBQUMsWUFBQSxFQUFBSixHQUFBO0VBQUEsSUFBQUEsR0FBQSxJQUFBSyxPQUFBLElBQUFBLE9BQUEsQ0FBQUwsR0FBQSxNQUFBYSxhQUFBLENBQUFiLEdBQUE7RUFBQUssT0FBQSxDQUFBTCxHQUFBLElBQUFhLGFBQUEsQ0FBQWIsR0FBQTtBQUFBO0FBTEEsSUFBQWMsVUFBQSxHQUFBcEIsT0FBQTtBQUNBLElBQUFxQixZQUFBLEdBQUF0Qix1QkFBQSxDQUFBQyxPQUFBO0FBR0EsSUFBQXNCLFFBQUEsR0FBQXRCLE9BQUE7QUFBQUcsTUFBQSxDQUFBQyxJQUFBLENBQUFrQixRQUFBLEVBQUFqQixPQUFBLFdBQUFDLEdBQUE7RUFBQSxJQUFBQSxHQUFBLGtCQUFBQSxHQUFBO0VBQUEsSUFBQUgsTUFBQSxDQUFBSSxTQUFBLENBQUFDLGNBQUEsQ0FBQUMsSUFBQSxDQUFBQyxZQUFBLEVBQUFKLEdBQUE7RUFBQSxJQUFBQSxHQUFBLElBQUFLLE9BQUEsSUFBQUEsT0FBQSxDQUFBTCxHQUFBLE1BQUFnQixRQUFBLENBQUFoQixHQUFBO0VBQUFLLE9BQUEsQ0FBQUwsR0FBQSxJQUFBZ0IsUUFBQSxDQUFBaEIsR0FBQTtBQUFBO0FBQTRCLFNBQUFpQix5QkFBQUMsV0FBQSxlQUFBQyxPQUFBLGtDQUFBQyxpQkFBQSxPQUFBRCxPQUFBLFFBQUFFLGdCQUFBLE9BQUFGLE9BQUEsWUFBQUYsd0JBQUEsWUFBQUEsQ0FBQUMsV0FBQSxXQUFBQSxXQUFBLEdBQUFHLGdCQUFBLEdBQUFELGlCQUFBLEtBQUFGLFdBQUE7QUFBQSxTQUFBekIsd0JBQUE2QixHQUFBLEVBQUFKLFdBQUEsU0FBQUEsV0FBQSxJQUFBSSxHQUFBLElBQUFBLEdBQUEsQ0FBQUMsVUFBQSxXQUFBRCxHQUFBLFFBQUFBLEdBQUEsb0JBQUFBLEdBQUEsd0JBQUFBLEdBQUEsNEJBQUFFLE9BQUEsRUFBQUYsR0FBQSxVQUFBRyxLQUFBLEdBQUFSLHdCQUFBLENBQUFDLFdBQUEsT0FBQU8sS0FBQSxJQUFBQSxLQUFBLENBQUFDLEdBQUEsQ0FBQUosR0FBQSxZQUFBRyxLQUFBLENBQUFFLEdBQUEsQ0FBQUwsR0FBQSxTQUFBTSxNQUFBLFdBQUFDLHFCQUFBLEdBQUFoQyxNQUFBLENBQUFpQyxjQUFBLElBQUFqQyxNQUFBLENBQUFrQyx3QkFBQSxXQUFBL0IsR0FBQSxJQUFBc0IsR0FBQSxRQUFBdEIsR0FBQSxrQkFBQUgsTUFBQSxDQUFBSSxTQUFBLENBQUFDLGNBQUEsQ0FBQUMsSUFBQSxDQUFBbUIsR0FBQSxFQUFBdEIsR0FBQSxTQUFBZ0MsSUFBQSxHQUFBSCxxQkFBQSxHQUFBaEMsTUFBQSxDQUFBa0Msd0JBQUEsQ0FBQVQsR0FBQSxFQUFBdEIsR0FBQSxjQUFBZ0MsSUFBQSxLQUFBQSxJQUFBLENBQUFMLEdBQUEsSUFBQUssSUFBQSxDQUFBQyxHQUFBLEtBQUFwQyxNQUFBLENBQUFpQyxjQUFBLENBQUFGLE1BQUEsRUFBQTVCLEdBQUEsRUFBQWdDLElBQUEsWUFBQUosTUFBQSxDQUFBNUIsR0FBQSxJQUFBc0IsR0FBQSxDQUFBdEIsR0FBQSxTQUFBNEIsTUFBQSxDQUFBSixPQUFBLEdBQUFGLEdBQUEsTUFBQUcsS0FBQSxJQUFBQSxLQUFBLENBQUFRLEdBQUEsQ0FBQVgsR0FBQSxFQUFBTSxNQUFBLFlBQUFBLE1BQUE7QUF6QzVCO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUErQk8sTUFBTU0sTUFBTSxTQUFTQyxtQkFBVyxDQUFDO0VBQ3RDO0VBQ0E7RUFDQTtFQUNBOztFQUVBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0FDLGtCQUFrQkEsQ0FBQ0MsVUFBVSxFQUFFQyxNQUFNLEVBQUVDLGlCQUFpQixFQUFFQyxTQUFTLEVBQUVDLE9BQU8sRUFBRUMsVUFBVSxFQUFFO0lBQ3hGLElBQUksQ0FBQyxJQUFBQyx5QkFBaUIsRUFBQ04sVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJekMsTUFBTSxDQUFDZ0Qsc0JBQXNCLENBQUMsdUJBQXVCLEdBQUdQLFVBQVUsQ0FBQztJQUMvRTtJQUNBLElBQUksQ0FBQyxJQUFBUSxnQkFBUSxFQUFDUCxNQUFNLENBQUMsRUFBRTtNQUNyQixNQUFNLElBQUlRLFNBQVMsQ0FBQyxtQ0FBbUMsQ0FBQztJQUMxRDtJQUNBLElBQUksQ0FBQyxJQUFBRCxnQkFBUSxFQUFDTixpQkFBaUIsQ0FBQyxFQUFFO01BQ2hDLE1BQU0sSUFBSU8sU0FBUyxDQUFDLDhDQUE4QyxDQUFDO0lBQ3JFO0lBQ0EsSUFBSSxDQUFDLElBQUFELGdCQUFRLEVBQUNMLFNBQVMsQ0FBQyxFQUFFO01BQ3hCLE1BQU0sSUFBSU0sU0FBUyxDQUFDLHNDQUFzQyxDQUFDO0lBQzdEO0lBQ0EsSUFBSSxDQUFDLElBQUFDLGdCQUFRLEVBQUNOLE9BQU8sQ0FBQyxFQUFFO01BQ3RCLE1BQU0sSUFBSUssU0FBUyxDQUFDLG9DQUFvQyxDQUFDO0lBQzNEO0lBQ0EsSUFBSSxDQUFDLElBQUFELGdCQUFRLEVBQUNILFVBQVUsQ0FBQyxFQUFFO01BQ3pCLE1BQU0sSUFBSUksU0FBUyxDQUFDLHVDQUF1QyxDQUFDO0lBQzlEO0lBQ0EsSUFBSUUsT0FBTyxHQUFHLEVBQUU7O0lBRWhCO0lBQ0FBLE9BQU8sQ0FBQ0MsSUFBSSxDQUFFLGFBQVksQ0FBQztJQUMzQkQsT0FBTyxDQUFDQyxJQUFJLENBQUUsbUJBQWtCLENBQUM7O0lBRWpDO0lBQ0FELE9BQU8sQ0FBQ0MsSUFBSSxDQUFFLFVBQVMsSUFBQUMsaUJBQVMsRUFBQ1osTUFBTSxDQUFFLEVBQUMsQ0FBQztJQUMzQ1UsT0FBTyxDQUFDQyxJQUFJLENBQUUsYUFBWSxJQUFBQyxpQkFBUyxFQUFDVixTQUFTLENBQUUsRUFBQyxDQUFDO0lBRWpELElBQUlELGlCQUFpQixFQUFFO01BQ3JCQSxpQkFBaUIsR0FBRyxJQUFBVyxpQkFBUyxFQUFDWCxpQkFBaUIsQ0FBQztNQUNoRFMsT0FBTyxDQUFDQyxJQUFJLENBQUUsc0JBQXFCVixpQkFBa0IsRUFBQyxDQUFDO0lBQ3pEO0lBQ0E7SUFDQSxJQUFJRyxVQUFVLEVBQUU7TUFDZEEsVUFBVSxHQUFHLElBQUFRLGlCQUFTLEVBQUNSLFVBQVUsQ0FBQztNQUNsQ00sT0FBTyxDQUFDQyxJQUFJLENBQUUsZUFBY1AsVUFBVyxFQUFDLENBQUM7SUFDM0M7SUFDQTtJQUNBLElBQUlELE9BQU8sRUFBRTtNQUNYLElBQUlBLE9BQU8sSUFBSSxJQUFJLEVBQUU7UUFDbkJBLE9BQU8sR0FBRyxJQUFJO01BQ2hCO01BQ0FPLE9BQU8sQ0FBQ0MsSUFBSSxDQUFFLFlBQVdSLE9BQVEsRUFBQyxDQUFDO0lBQ3JDO0lBQ0FPLE9BQU8sQ0FBQ0csSUFBSSxDQUFDLENBQUM7SUFDZCxJQUFJQyxLQUFLLEdBQUcsRUFBRTtJQUNkLElBQUlKLE9BQU8sQ0FBQ0ssTUFBTSxHQUFHLENBQUMsRUFBRTtNQUN0QkQsS0FBSyxHQUFJLEdBQUVKLE9BQU8sQ0FBQ00sSUFBSSxDQUFDLEdBQUcsQ0FBRSxFQUFDO0lBQ2hDO0lBQ0EsSUFBSUMsTUFBTSxHQUFHLEtBQUs7SUFDbEIsSUFBSUMsV0FBVyxHQUFHekMsWUFBWSxDQUFDMEMsMkJBQTJCLENBQUMsQ0FBQztJQUM1RCxJQUFJLENBQUNDLFdBQVcsQ0FBQztNQUFFSCxNQUFNO01BQUVsQixVQUFVO01BQUVlO0lBQU0sQ0FBQyxFQUFFLEVBQUUsRUFBRSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsQ0FBQ08sQ0FBQyxFQUFFQyxRQUFRLEtBQUs7TUFDcEYsSUFBSUQsQ0FBQyxFQUFFO1FBQ0wsT0FBT0gsV0FBVyxDQUFDSyxJQUFJLENBQUMsT0FBTyxFQUFFRixDQUFDLENBQUM7TUFDckM7TUFDQSxJQUFBRyxpQkFBUyxFQUFDRixRQUFRLEVBQUVKLFdBQVcsQ0FBQztJQUNsQyxDQUFDLENBQUM7SUFDRixPQUFPQSxXQUFXO0VBQ3BCOztFQUVBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0E7RUFDQTtFQUNBTyxhQUFhQSxDQUFDMUIsVUFBVSxFQUFFQyxNQUFNLEVBQUUwQixTQUFTLEVBQUV0QixVQUFVLEVBQUU7SUFDdkQsSUFBSUosTUFBTSxLQUFLMkIsU0FBUyxFQUFFO01BQ3hCM0IsTUFBTSxHQUFHLEVBQUU7SUFDYjtJQUNBLElBQUkwQixTQUFTLEtBQUtDLFNBQVMsRUFBRTtNQUMzQkQsU0FBUyxHQUFHLEtBQUs7SUFDbkI7SUFDQSxJQUFJdEIsVUFBVSxLQUFLdUIsU0FBUyxFQUFFO01BQzVCdkIsVUFBVSxHQUFHLEVBQUU7SUFDakI7SUFDQSxJQUFJLENBQUMsSUFBQUMseUJBQWlCLEVBQUNOLFVBQVUsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sSUFBSXpDLE1BQU0sQ0FBQ2dELHNCQUFzQixDQUFDLHVCQUF1QixHQUFHUCxVQUFVLENBQUM7SUFDL0U7SUFDQSxJQUFJLENBQUMsSUFBQTZCLHFCQUFhLEVBQUM1QixNQUFNLENBQUMsRUFBRTtNQUMxQixNQUFNLElBQUkxQyxNQUFNLENBQUN1RSxrQkFBa0IsQ0FBRSxvQkFBbUI3QixNQUFPLEVBQUMsQ0FBQztJQUNuRTtJQUNBLElBQUksQ0FBQyxJQUFBTyxnQkFBUSxFQUFDUCxNQUFNLENBQUMsRUFBRTtNQUNyQixNQUFNLElBQUlRLFNBQVMsQ0FBQyxtQ0FBbUMsQ0FBQztJQUMxRDtJQUNBLElBQUksQ0FBQyxJQUFBc0IsaUJBQVMsRUFBQ0osU0FBUyxDQUFDLEVBQUU7TUFDekIsTUFBTSxJQUFJbEIsU0FBUyxDQUFDLHVDQUF1QyxDQUFDO0lBQzlEO0lBQ0EsSUFBSSxDQUFDLElBQUFELGdCQUFRLEVBQUNILFVBQVUsQ0FBQyxFQUFFO01BQ3pCLE1BQU0sSUFBSUksU0FBUyxDQUFDLHVDQUF1QyxDQUFDO0lBQzlEO0lBQ0E7SUFDQSxJQUFJTixTQUFTLEdBQUd3QixTQUFTLEdBQUcsRUFBRSxHQUFHLEdBQUc7SUFDcEMsSUFBSXpCLGlCQUFpQixHQUFHLEVBQUU7SUFDMUIsSUFBSThCLE9BQU8sR0FBRyxFQUFFO0lBQ2hCLElBQUlDLEtBQUssR0FBRyxLQUFLO0lBQ2pCLElBQUlDLFVBQVUsR0FBRy9FLE1BQU0sQ0FBQ2dGLFFBQVEsQ0FBQztNQUFFQyxVQUFVLEVBQUU7SUFBSyxDQUFDLENBQUM7SUFDdERGLFVBQVUsQ0FBQ0csS0FBSyxHQUFHLE1BQU07TUFDdkI7TUFDQSxJQUFJTCxPQUFPLENBQUNoQixNQUFNLEVBQUU7UUFDbEJrQixVQUFVLENBQUN0QixJQUFJLENBQUNvQixPQUFPLENBQUNNLEtBQUssQ0FBQyxDQUFDLENBQUM7UUFDaEM7TUFDRjtNQUNBLElBQUlMLEtBQUssRUFBRTtRQUNULE9BQU9DLFVBQVUsQ0FBQ3RCLElBQUksQ0FBQyxJQUFJLENBQUM7TUFDOUI7TUFDQTtNQUNBLElBQUksQ0FBQ2Isa0JBQWtCLENBQUNDLFVBQVUsRUFBRUMsTUFBTSxFQUFFQyxpQkFBaUIsRUFBRUMsU0FBUyxFQUFFLElBQUksRUFBRUUsVUFBVSxDQUFDLENBQ3hGa0MsRUFBRSxDQUFDLE9BQU8sRUFBR2pCLENBQUMsSUFBS1ksVUFBVSxDQUFDVixJQUFJLENBQUMsT0FBTyxFQUFFRixDQUFDLENBQUMsQ0FBQyxDQUMvQ2lCLEVBQUUsQ0FBQyxNQUFNLEVBQUdDLE1BQU0sSUFBSztRQUN0QixJQUFJQSxNQUFNLENBQUNDLFdBQVcsRUFBRTtVQUN0QnZDLGlCQUFpQixHQUFHc0MsTUFBTSxDQUFDRSxxQkFBcUI7UUFDbEQsQ0FBQyxNQUFNO1VBQ0xULEtBQUssR0FBRyxJQUFJO1FBQ2Q7UUFDQUQsT0FBTyxHQUFHUSxNQUFNLENBQUNSLE9BQU87UUFDeEJFLFVBQVUsQ0FBQ0csS0FBSyxDQUFDLENBQUM7TUFDcEIsQ0FBQyxDQUFDO0lBQ04sQ0FBQztJQUNELE9BQU9ILFVBQVU7RUFDbkI7O0VBRUE7RUFDQVMscUJBQXFCQSxDQUFDM0MsVUFBVSxFQUFFNEMsTUFBTSxFQUFFQyxFQUFFLEVBQUU7SUFDNUMsSUFBSSxDQUFDLElBQUF2Qyx5QkFBaUIsRUFBQ04sVUFBVSxDQUFDLEVBQUU7TUFDbEMsTUFBTSxJQUFJekMsTUFBTSxDQUFDZ0Qsc0JBQXNCLENBQUMsdUJBQXVCLEdBQUdQLFVBQVUsQ0FBQztJQUMvRTtJQUNBLElBQUksQ0FBQyxJQUFBOEMsZ0JBQVEsRUFBQ0YsTUFBTSxDQUFDLEVBQUU7TUFDckIsTUFBTSxJQUFJbkMsU0FBUyxDQUFDLGdEQUFnRCxDQUFDO0lBQ3ZFO0lBQ0EsSUFBSSxDQUFDLElBQUFzQyxrQkFBVSxFQUFDRixFQUFFLENBQUMsRUFBRTtNQUNuQixNQUFNLElBQUlwQyxTQUFTLENBQUMsdUNBQXVDLENBQUM7SUFDOUQ7SUFDQSxJQUFJUyxNQUFNLEdBQUcsS0FBSztJQUNsQixJQUFJSCxLQUFLLEdBQUcsY0FBYztJQUMxQixJQUFJaUMsT0FBTyxHQUFHLElBQUlDLE9BQU0sQ0FBQ0MsT0FBTyxDQUFDO01BQy9CQyxRQUFRLEVBQUUsMkJBQTJCO01BQ3JDQyxVQUFVLEVBQUU7UUFBRUMsTUFBTSxFQUFFO01BQU0sQ0FBQztNQUM3QkMsUUFBUSxFQUFFO0lBQ1osQ0FBQyxDQUFDO0lBQ0YsSUFBSUMsT0FBTyxHQUFHUCxPQUFPLENBQUNRLFdBQVcsQ0FBQ1osTUFBTSxDQUFDO0lBQ3pDLElBQUksQ0FBQ3ZCLFdBQVcsQ0FBQztNQUFFSCxNQUFNO01BQUVsQixVQUFVO01BQUVlO0lBQU0sQ0FBQyxFQUFFd0MsT0FBTyxFQUFFLENBQUMsR0FBRyxDQUFDLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRVYsRUFBRSxDQUFDO0VBQ2hGO0VBRUFZLDJCQUEyQkEsQ0FBQ3pELFVBQVUsRUFBRTZDLEVBQUUsRUFBRTtJQUMxQyxJQUFJLENBQUNGLHFCQUFxQixDQUFDM0MsVUFBVSxFQUFFLElBQUkwRCxnQ0FBa0IsQ0FBQyxDQUFDLEVBQUViLEVBQUUsQ0FBQztFQUN0RTs7RUFFQTtFQUNBO0VBQ0FjLHFCQUFxQkEsQ0FBQzNELFVBQVUsRUFBRTZDLEVBQUUsRUFBRTtJQUNwQyxJQUFJLENBQUMsSUFBQXZDLHlCQUFpQixFQUFDTixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUl6QyxNQUFNLENBQUNnRCxzQkFBc0IsQ0FBQyx1QkFBdUIsR0FBR1AsVUFBVSxDQUFDO0lBQy9FO0lBQ0EsSUFBSSxDQUFDLElBQUErQyxrQkFBVSxFQUFDRixFQUFFLENBQUMsRUFBRTtNQUNuQixNQUFNLElBQUlwQyxTQUFTLENBQUMsdUNBQXVDLENBQUM7SUFDOUQ7SUFDQSxJQUFJUyxNQUFNLEdBQUcsS0FBSztJQUNsQixJQUFJSCxLQUFLLEdBQUcsY0FBYztJQUMxQixJQUFJLENBQUNNLFdBQVcsQ0FBQztNQUFFSCxNQUFNO01BQUVsQixVQUFVO01BQUVlO0lBQU0sQ0FBQyxFQUFFLEVBQUUsRUFBRSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsQ0FBQ08sQ0FBQyxFQUFFQyxRQUFRLEtBQUs7TUFDcEYsSUFBSUQsQ0FBQyxFQUFFO1FBQ0wsT0FBT3VCLEVBQUUsQ0FBQ3ZCLENBQUMsQ0FBQztNQUNkO01BQ0EsSUFBSUgsV0FBVyxHQUFHekMsWUFBWSxDQUFDa0YsZ0NBQWdDLENBQUMsQ0FBQztNQUNqRSxJQUFJQyxrQkFBa0I7TUFDdEIsSUFBQXBDLGlCQUFTLEVBQUNGLFFBQVEsRUFBRUosV0FBVyxDQUFDLENBQzdCb0IsRUFBRSxDQUFDLE1BQU0sRUFBR0MsTUFBTSxJQUFNcUIsa0JBQWtCLEdBQUdyQixNQUFPLENBQUMsQ0FDckRELEVBQUUsQ0FBQyxPQUFPLEVBQUdqQixDQUFDLElBQUt1QixFQUFFLENBQUN2QixDQUFDLENBQUMsQ0FBQyxDQUN6QmlCLEVBQUUsQ0FBQyxLQUFLLEVBQUUsTUFBTU0sRUFBRSxDQUFDLElBQUksRUFBRWdCLGtCQUFrQixDQUFDLENBQUM7SUFDbEQsQ0FBQyxDQUFDO0VBQ0o7O0VBRUE7RUFDQUMsd0JBQXdCQSxDQUFDOUQsVUFBVSxFQUFFQyxNQUFNLEVBQUU4RCxNQUFNLEVBQUVDLE1BQU0sRUFBRTtJQUMzRCxJQUFJLENBQUMsSUFBQTFELHlCQUFpQixFQUFDTixVQUFVLENBQUMsRUFBRTtNQUNsQyxNQUFNLElBQUl6QyxNQUFNLENBQUNnRCxzQkFBc0IsQ0FBRSx3QkFBdUJQLFVBQVcsRUFBQyxDQUFDO0lBQy9FO0lBQ0EsSUFBSSxDQUFDLElBQUFRLGdCQUFRLEVBQUNQLE1BQU0sQ0FBQyxFQUFFO01BQ3JCLE1BQU0sSUFBSVEsU0FBUyxDQUFDLCtCQUErQixDQUFDO0lBQ3REO0lBQ0EsSUFBSSxDQUFDLElBQUFELGdCQUFRLEVBQUN1RCxNQUFNLENBQUMsRUFBRTtNQUNyQixNQUFNLElBQUl0RCxTQUFTLENBQUMsK0JBQStCLENBQUM7SUFDdEQ7SUFDQSxJQUFJLENBQUN3RCxLQUFLLENBQUNDLE9BQU8sQ0FBQ0YsTUFBTSxDQUFDLEVBQUU7TUFDMUIsTUFBTSxJQUFJdkQsU0FBUyxDQUFDLDhCQUE4QixDQUFDO0lBQ3JEO0lBQ0EsSUFBSTBELFFBQVEsR0FBRyxJQUFJQyxnQ0FBa0IsQ0FBQyxJQUFJLEVBQUVwRSxVQUFVLEVBQUVDLE1BQU0sRUFBRThELE1BQU0sRUFBRUMsTUFBTSxDQUFDO0lBQy9FRyxRQUFRLENBQUNFLEtBQUssQ0FBQyxDQUFDO0lBRWhCLE9BQU9GLFFBQVE7RUFDakI7QUFDRjtBQUFDbkcsT0FBQSxDQUFBNkIsTUFBQSxHQUFBQSxNQUFBO0FBRURBLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQytGLHFCQUFxQixHQUFHLElBQUFXLG9CQUFTLEVBQUN6RSxNQUFNLENBQUNqQyxTQUFTLENBQUMrRixxQkFBcUIsQ0FBQztBQUMxRjlELE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQytFLHFCQUFxQixHQUFHLElBQUEyQixvQkFBUyxFQUFDekUsTUFBTSxDQUFDakMsU0FBUyxDQUFDK0UscUJBQXFCLENBQUM7QUFDMUY5QyxNQUFNLENBQUNqQyxTQUFTLENBQUM2RiwyQkFBMkIsR0FBRyxJQUFBYSxvQkFBUyxFQUFDekUsTUFBTSxDQUFDakMsU0FBUyxDQUFDNkYsMkJBQTJCLENBQUM7O0FBRXRHO0FBQ0E1RCxNQUFNLENBQUNqQyxTQUFTLENBQUMyRyxVQUFVLEdBQUcsSUFBQUMsd0JBQVcsRUFBQzNFLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQzJHLFVBQVUsQ0FBQztBQUN0RTFFLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQzZHLFlBQVksR0FBRyxJQUFBRCx3QkFBVyxFQUFDM0UsTUFBTSxDQUFDakMsU0FBUyxDQUFDNkcsWUFBWSxDQUFDO0FBQzFFNUUsTUFBTSxDQUFDakMsU0FBUyxDQUFDOEcsWUFBWSxHQUFHLElBQUFGLHdCQUFXLEVBQUMzRSxNQUFNLENBQUNqQyxTQUFTLENBQUM4RyxZQUFZLENBQUM7QUFDMUU3RSxNQUFNLENBQUNqQyxTQUFTLENBQUMrRyxXQUFXLEdBQUcsSUFBQUgsd0JBQVcsRUFBQzNFLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQytHLFdBQVcsQ0FBQztBQUV4RTlFLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQ2dILFNBQVMsR0FBRyxJQUFBSix3QkFBVyxFQUFDM0UsTUFBTSxDQUFDakMsU0FBUyxDQUFDZ0gsU0FBUyxDQUFDO0FBQ3BFL0UsTUFBTSxDQUFDakMsU0FBUyxDQUFDaUgsVUFBVSxHQUFHLElBQUFMLHdCQUFXLEVBQUMzRSxNQUFNLENBQUNqQyxTQUFTLENBQUNpSCxVQUFVLENBQUM7QUFDdEVoRixNQUFNLENBQUNqQyxTQUFTLENBQUNrSCxnQkFBZ0IsR0FBRyxJQUFBTix3QkFBVyxFQUFDM0UsTUFBTSxDQUFDakMsU0FBUyxDQUFDa0gsZ0JBQWdCLENBQUM7QUFDbEZqRixNQUFNLENBQUNqQyxTQUFTLENBQUNtSCxVQUFVLEdBQUcsSUFBQVAsd0JBQVcsRUFBQzNFLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQ21ILFVBQVUsQ0FBQztBQUN0RWxGLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQ29ILGtCQUFrQixHQUFHLElBQUFSLHdCQUFXLEVBQUMzRSxNQUFNLENBQUNqQyxTQUFTLENBQUNvSCxrQkFBa0IsQ0FBQztBQUN0Rm5GLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQ3FILFNBQVMsR0FBRyxJQUFBVCx3QkFBVyxFQUFDM0UsTUFBTSxDQUFDakMsU0FBUyxDQUFDcUgsU0FBUyxDQUFDO0FBQ3BFcEYsTUFBTSxDQUFDakMsU0FBUyxDQUFDc0gsVUFBVSxHQUFHLElBQUFWLHdCQUFXLEVBQUMzRSxNQUFNLENBQUNqQyxTQUFTLENBQUNzSCxVQUFVLENBQUM7QUFDdEVyRixNQUFNLENBQUNqQyxTQUFTLENBQUN1SCxZQUFZLEdBQUcsSUFBQVgsd0JBQVcsRUFBQzNFLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQ3VILFlBQVksQ0FBQztBQUUxRXRGLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQ3dILHVCQUF1QixHQUFHLElBQUFaLHdCQUFXLEVBQUMzRSxNQUFNLENBQUNqQyxTQUFTLENBQUN3SCx1QkFBdUIsQ0FBQztBQUNoR3ZGLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQ3lILG9CQUFvQixHQUFHLElBQUFiLHdCQUFXLEVBQUMzRSxNQUFNLENBQUNqQyxTQUFTLENBQUN5SCxvQkFBb0IsQ0FBQztBQUMxRnhGLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQzBILG9CQUFvQixHQUFHLElBQUFkLHdCQUFXLEVBQUMzRSxNQUFNLENBQUNqQyxTQUFTLENBQUMwSCxvQkFBb0IsQ0FBQztBQUMxRnpGLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQzJILGtCQUFrQixHQUFHLElBQUFmLHdCQUFXLEVBQUMzRSxNQUFNLENBQUNqQyxTQUFTLENBQUMySCxrQkFBa0IsQ0FBQztBQUN0RjFGLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQzRILGtCQUFrQixHQUFHLElBQUFoQix3QkFBVyxFQUFDM0UsTUFBTSxDQUFDakMsU0FBUyxDQUFDNEgsa0JBQWtCLENBQUM7QUFDdEYzRixNQUFNLENBQUNqQyxTQUFTLENBQUM2SCxtQkFBbUIsR0FBRyxJQUFBakIsd0JBQVcsRUFBQzNFLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQzZILG1CQUFtQixDQUFDO0FBQ3hGNUYsTUFBTSxDQUFDakMsU0FBUyxDQUFDOEgsbUJBQW1CLEdBQUcsSUFBQWxCLHdCQUFXLEVBQUMzRSxNQUFNLENBQUNqQyxTQUFTLENBQUM4SCxtQkFBbUIsQ0FBQztBQUN4RjdGLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQytILGVBQWUsR0FBRyxJQUFBbkIsd0JBQVcsRUFBQzNFLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQytILGVBQWUsQ0FBQztBQUNoRjlGLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQ2dJLGVBQWUsR0FBRyxJQUFBcEIsd0JBQVcsRUFBQzNFLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQ2dJLGVBQWUsQ0FBQztBQUNoRi9GLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQ2lJLGdCQUFnQixHQUFHLElBQUFyQix3QkFBVyxFQUFDM0UsTUFBTSxDQUFDakMsU0FBUyxDQUFDaUksZ0JBQWdCLENBQUM7QUFDbEZoRyxNQUFNLENBQUNqQyxTQUFTLENBQUNrSSxnQkFBZ0IsR0FBRyxJQUFBdEIsd0JBQVcsRUFBQzNFLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQ2tJLGdCQUFnQixDQUFDO0FBQ2xGakcsTUFBTSxDQUFDakMsU0FBUyxDQUFDbUksZ0JBQWdCLEdBQUcsSUFBQXZCLHdCQUFXLEVBQUMzRSxNQUFNLENBQUNqQyxTQUFTLENBQUNtSSxnQkFBZ0IsQ0FBQztBQUNsRmxHLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQ29JLG1CQUFtQixHQUFHLElBQUF4Qix3QkFBVyxFQUFDM0UsTUFBTSxDQUFDakMsU0FBUyxDQUFDb0ksbUJBQW1CLENBQUM7QUFDeEZuRyxNQUFNLENBQUNqQyxTQUFTLENBQUNxSSxnQkFBZ0IsR0FBRyxJQUFBekIsd0JBQVcsRUFBQzNFLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQ3FJLGdCQUFnQixDQUFDO0FBQ2xGcEcsTUFBTSxDQUFDakMsU0FBUyxDQUFDc0ksbUJBQW1CLEdBQUcsSUFBQTFCLHdCQUFXLEVBQUMzRSxNQUFNLENBQUNqQyxTQUFTLENBQUNzSSxtQkFBbUIsQ0FBQztBQUN4RnJHLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQ3VJLG1CQUFtQixHQUFHLElBQUEzQix3QkFBVyxFQUFDM0UsTUFBTSxDQUFDakMsU0FBUyxDQUFDdUksbUJBQW1CLENBQUM7QUFDeEZ0RyxNQUFNLENBQUNqQyxTQUFTLENBQUN3SSxtQkFBbUIsR0FBRyxJQUFBNUIsd0JBQVcsRUFBQzNFLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQ3dJLG1CQUFtQixDQUFDO0FBQ3hGdkcsTUFBTSxDQUFDakMsU0FBUyxDQUFDeUksbUJBQW1CLEdBQUcsSUFBQTdCLHdCQUFXLEVBQUMzRSxNQUFNLENBQUNqQyxTQUFTLENBQUN5SSxtQkFBbUIsQ0FBQztBQUN4RnhHLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQzBJLGtCQUFrQixHQUFHLElBQUE5Qix3QkFBVyxFQUFDM0UsTUFBTSxDQUFDakMsU0FBUyxDQUFDMEksa0JBQWtCLENBQUM7QUFDdEZ6RyxNQUFNLENBQUNqQyxTQUFTLENBQUMySSxrQkFBa0IsR0FBRyxJQUFBL0Isd0JBQVcsRUFBQzNFLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQzJJLGtCQUFrQixDQUFDO0FBQ3RGMUcsTUFBTSxDQUFDakMsU0FBUyxDQUFDNEkscUJBQXFCLEdBQUcsSUFBQWhDLHdCQUFXLEVBQUMzRSxNQUFNLENBQUNqQyxTQUFTLENBQUM0SSxxQkFBcUIsQ0FBQztBQUM1RjNHLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQzZJLG1CQUFtQixHQUFHLElBQUFqQyx3QkFBVyxFQUFDM0UsTUFBTSxDQUFDakMsU0FBUyxDQUFDNkksbUJBQW1CLENBQUM7QUFDeEY1RyxNQUFNLENBQUNqQyxTQUFTLENBQUM4SSxtQkFBbUIsR0FBRyxJQUFBbEMsd0JBQVcsRUFBQzNFLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQzhJLG1CQUFtQixDQUFDO0FBQ3hGN0csTUFBTSxDQUFDakMsU0FBUyxDQUFDK0ksc0JBQXNCLEdBQUcsSUFBQW5DLHdCQUFXLEVBQUMzRSxNQUFNLENBQUNqQyxTQUFTLENBQUMrSSxzQkFBc0IsQ0FBQztBQUM5RjlHLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQ2dKLGtCQUFrQixHQUFHLElBQUFwQyx3QkFBVyxFQUFDM0UsTUFBTSxDQUFDakMsU0FBUyxDQUFDZ0osa0JBQWtCLENBQUM7QUFDdEYvRyxNQUFNLENBQUNqQyxTQUFTLENBQUNpSixhQUFhLEdBQUcsSUFBQXJDLHdCQUFXLEVBQUMzRSxNQUFNLENBQUNqQyxTQUFTLENBQUNpSixhQUFhLENBQUM7QUFDNUVoSCxNQUFNLENBQUNqQyxTQUFTLENBQUNrSixzQkFBc0IsR0FBRyxJQUFBdEMsd0JBQVcsRUFBQzNFLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQ2tKLHNCQUFzQixDQUFDO0FBQzlGakgsTUFBTSxDQUFDakMsU0FBUyxDQUFDbUosVUFBVSxHQUFHLElBQUF2Qyx3QkFBVyxFQUFDM0UsTUFBTSxDQUFDakMsU0FBUyxDQUFDbUosVUFBVSxDQUFDO0FBQ3RFbEgsTUFBTSxDQUFDakMsU0FBUyxDQUFDb0osYUFBYSxHQUFHLElBQUF4Qyx3QkFBVyxFQUFDM0UsTUFBTSxDQUFDakMsU0FBUyxDQUFDb0osYUFBYSxDQUFDO0FBQzVFbkgsTUFBTSxDQUFDakMsU0FBUyxDQUFDcUosWUFBWSxHQUFHLElBQUF6Qyx3QkFBVyxFQUFDM0UsTUFBTSxDQUFDakMsU0FBUyxDQUFDcUosWUFBWSxDQUFDO0FBQzFFcEgsTUFBTSxDQUFDakMsU0FBUyxDQUFDc0osa0JBQWtCLEdBQUcsSUFBQTFDLHdCQUFXLEVBQUMzRSxNQUFNLENBQUNqQyxTQUFTLENBQUNzSixrQkFBa0IsQ0FBQztBQUN0RnJILE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQ3VKLGtCQUFrQixHQUFHLElBQUEzQyx3QkFBVyxFQUFDM0UsTUFBTSxDQUFDakMsU0FBUyxDQUFDdUosa0JBQWtCLENBQUM7QUFDdEZ0SCxNQUFNLENBQUNqQyxTQUFTLENBQUN3SixtQkFBbUIsR0FBRyxJQUFBNUMsd0JBQVcsRUFBQzNFLE1BQU0sQ0FBQ2pDLFNBQVMsQ0FBQ3dKLG1CQUFtQixDQUFDIn0=