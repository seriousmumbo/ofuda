"use strict";
/*
 * ofuda
 * https://github.com/wolfeidau/ofuda
 *
 * Copyright (c) 2012 Mark Wolfe
 * Licensed under the MIT license.
 */

var crypto = require('crypto'),
    cryptiles = require('cryptiles'),
    _ = require('lodash');

/**
 *
 * Setup ofuda with `options`.
 *
 *   - `headerPrefix` string to match for extra x- headers to be included in the signature.
 *   - `serviceLabel` string used in the Authorisation header to indicate the authenticating service.
 *   - `hash` string which dictates which hash to use, defaults to sha.
 *   - `debug` boolean which enables debug mode.
 *
 * @param options
 * @constructor
 */
function Ofuda(options) {
    options = options || {};
    this.options = options;

    this.headerPrefix(options.headerPrefix);
    this.serviceLabel(options.serviceLabel);
    this.hash(options.hash);
    this.debug(options.debug);
}

/**
 * Header prefix for extra x- headers to be included in the signature.
 *
 * @return {Ofuda}
 * @api public
 */

Ofuda.prototype.headerPrefix = function (prefix) {
    this.options.headerPrefix = prefix;
    return this;
};

/**
 * Hash function which is used in the hmac, this currently defaults to sha1
 *
 * @param hash
 * @return {*}
 */
Ofuda.prototype.hash = function (hash) {
    this.options.hash = hash ? hash : 'sha1';
    return this;
};

/**
 * Service label which is included in the Authorisation header before the accessKey and signature.
 *
 * @param serviceLabel
 */
Ofuda.prototype.serviceLabel = function (serviceLabel) {
    this.options.serviceLabel = serviceLabel ? serviceLabel : 'AuthHmac';
    return this;
};

/**
 * Enable debug output.
 *
 * @param debug
 * @return {*}
 */
Ofuda.prototype.debug = function (debug) {
    this.options.debug = debug ? debug : false;
    return this;
};

/**
 * Filters headers which match the configured headerPrefix, this check IS case sensitive.
 *
 * @param request
 * @return {*}
 * @private
 */
Ofuda.prototype._locateHeadersByPrefix = function (request) {
    var self = this;
    return _.filter(_.keys(request.headers), function (key) {
        if (key.indexOf(self.options.headerPrefix) !== -1) {
            return key;
        }
    });
};

/**
 * Lower case the header names.
 *
 * @param request
 * @return {{}}
 * @private
 */
Ofuda.prototype._lowerCaseHeaders = function(request){

    var _headers = {}
    Object.keys(request.headers).forEach(function(key){_headers[key.toLowerCase()] = request.headers[key]})

    return _headers;
}

/**
 * Assemble the canonical string from a request which will be signed.
 *
 * @param request
 * @private
 */
Ofuda.prototype._buildCanonicalStringFromRequest = function (request) {

    var _headers = this._lowerCaseHeaders(request);

    return _.union([request.method, _headers['content-md5'], _headers['content-type'], _headers.date],
        _.map(this._locateHeadersByPrefix(request),function (headerName) {
            return headerName.toLowerCase() + ':' + request.headers[headerName];
        }).sort()//,
        //request.path || request.url
    ).join('\n');

};

/**
 * Any required options are checked and errors raised if they are not supplied.
 *
 * @param credentials object containing accessKeyId and accessKeySecret
 * @private
 */
Ofuda.prototype._validateRequiredOptions = function (credentials) {

    if (typeof credentials.accessKeyId == "undefined") {
        throw new Error('No accessKeyId was provided');
    }

    if (typeof credentials.accessKeySecret == "undefined") {
        throw new Error('No accessKeySecret was provided');
    }

};

/**
 * Generate a HMAC signature using the supplied canonicalString.
 *
 * @param canonicalString
 * @param credentials object containing accessKeyId and accessKeySecret
 * @return {*}
 * @private
 */
Ofuda.prototype._generateHMACSignature = function (credentials, canonicalString) {
    if (this.options.debug) {
        console.log('accessKeyId = ' + credentials.accessKeyId);
        console.log('canonicalString = ' + JSON.stringify(canonicalString));
    }
    return crypto.createHmac(this.options.hash, credentials.accessKeySecret).update(canonicalString).digest('base64');
};

/**
 * Add a hmac authorisation header to the request supplied.
 *
 * @param request
 * @param credentials object containing accessKeyId and accessKeySecret
 * @param canonicalStringCallback
 * @return {*}
 */
Ofuda.prototype.signHttpRequest = function (credentials, request, canonicalStringCallback) {

    // check required options
    this._validateRequiredOptions(credentials);

    if (canonicalStringCallback && typeof(canonicalStringCallback) === "function") {
        request.headers.Authorization = this.options.serviceLabel + ' ' + credentials.accessKeyId + ':' +
            this._generateHMACSignature(credentials, canonicalStringCallback(request));
    } else {
        request.headers.Authorization = this.options.serviceLabel + ' ' + credentials.accessKeyId + ':' +
            this._generateHMACSignature(credentials, this._buildCanonicalStringFromRequest(request));
    }

    return request;
};

/**
 * Validate the HMAC authorisation header in the supplied request using the auth callback to retrieve the credentials.
 *
 * @param request
 * @param authCallback
 * @return {Boolean}
 */
Ofuda.prototype.validateHttpRequest = function (request, authCallback) {

    var authorization = this._lowerCaseHeaders(request).authorization;

    if (this.options.debug) {
        console.log('authorization = ' + authorization);
    }

    if (_.isString(authorization)) {

        var tokens = authorization.split(' ');

        if (tokens.length == 2) {

            var accessKeyTokens = tokens[1].split(':');

            if (accessKeyTokens.length == 2) {

                var accessKeyId = accessKeyTokens[0],
                    suppliedSignature = accessKeyTokens[1];

                var credentials = authCallback(accessKeyId);

                if (_.isObject(credentials)) {

                    var generatedSignature = this._generateHMACSignature(credentials, this._buildCanonicalStringFromRequest(request));

                    if (cryptiles.fixedTimeComparison(suppliedSignature, generatedSignature)) {
                        return true;
                    }
                }
            }
        }
    }

    return false;
};

/**
 * Validate the HMAC authorisation header in the supplied request using the asynchronous auth callback to retrieve the credentials.
 *
 * @param request
 * @param authCallback
 * @return (callback) {Boolean}
 */
Ofuda.prototype.validateHttpRequestAsync = function (request, authCallback, callback) {
    var fail = function() { return callback({ result: false }); }
    var authorization = this._lowerCaseHeaders(request).authorization;
    if (this.options.debug) {
        console.log('authorization = ' + authorization);
    }
    if (_.isString(authorization)) {
        var tokens = authorization.split(' ');
        if (tokens.length == 2) {
            var accessKeyTokens = tokens[1].split(':');
            if (accessKeyTokens.length == 2) {
                var accessKeyId = accessKeyTokens[0],
                    suppliedSignature = accessKeyTokens[1];
                var self = this;
                var credentials = authCallback(accessKeyId, function(credentials) {
                   if (_.isObject(credentials)) {
                        var generatedSignature = self._generateHMACSignature(credentials, self._buildCanonicalStringFromRequest(request));
                        if (cryptiles.fixedTimeComparison(suppliedSignature, generatedSignature)) {
                            return callback({ result: true,
                                              accessKeyId: accessKeyId });
                        } else fail();
                   } else fail();
                });
            } else fail();
        } else fail();
    } else fail();
};


var defCredentialProvider = function(key, callback) {
	throw new Error('Ofuda::credentialProvider.  You have not specified a credential provider in your Ofuda options.  This is the default being called right now.');
};

Ofuda.middleware = function(opts, customResponder) {
	var OFUDA = !!opts && opts instanceof Ofuda ? opts : new Ofuda(opts);
	if (!OFUDA.options.credentialProvider || OFUDA.options.credentialProvider === defCredentialProvider) throw new Error('Ofuda::middleware requires a credentialProvider to work');

	customResponder = customResponder || function(valid, req, res, next) {
		if (true === valid) {
			return next();

		} else {
			res.statusCode = 401;
			return next(new Error('Unauthorized [ofuda]'));
		}
	};

	return function (req, res, next) {
		if (OFUDA.options.async) {
			OFUDA.validateHttpRequestAsync(req, OFUDA.options.credentialProvider, function(result) {
				var valid = result && result.result ? result.result : false;
				return customResponder.apply(this, [valid, req, res, next]);
			});
		} else {
			var valid = OFUDA.validateHttpRequest(req, OFUDA.options.credentialProvider);
			return customResponder.apply(this, [valid, req, res, next]);
		}
	};
};


exports = module.exports = Ofuda;

