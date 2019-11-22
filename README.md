# Overview

This module is a component for use in [pixl-server](https://www.npmjs.com/package/pixl-server).  It implements a simple web server with support for both HTTP and HTTPS, serving static files, and hooks for adding custom URI handlers.

# Table of Contents

<!-- toc -->
- [Usage](#usage)
- [Configuration](#configuration)
	* [http_port](#http_port)
	* [http_bind_address](#http_bind_address)
	* [http_htdocs_dir](#http_htdocs_dir)
	* [http_max_upload_size](#http_max_upload_size)
	* [http_temp_dir](#http_temp_dir)
	* [http_static_ttl](#http_static_ttl)
	* [http_static_index](#http_static_index)
	* [http_server_signature](#http_server_signature)
	* [http_compress_text](#http_compress_text)
	* [http_regex_text](#http_regex_text)
	* [http_regex_json](#http_regex_json)
	* [http_response_headers](#http_response_headers)
	* [http_timeout](#http_timeout)
	* [http_keep_alives](#http_keep_alives)
		+ [default](#default)
		+ [request](#request)
		+ [close](#close)
	* [http_keep_alive_timeout](#http_keep_alive_timeout)
	* [http_max_requests_per_connection](#http_max_requests_per_connection)
	* [http_gzip_opts](#http_gzip_opts)
	* [http_enable_brotli](#http_enable_brotli)
	* [http_brotli_opts](#http_brotli_opts)
	* [http_default_acl](#http_default_acl)
	* [http_log_requests](#http_log_requests)
	* [http_regex_log](#http_regex_log)
	* [http_recent_requests](#http_recent_requests)
	* [http_max_connections](#http_max_connections)
	* [http_max_concurrent_requests](#http_max_concurrent_requests)
	* [http_clean_headers](#http_clean_headers)
	* [http_log_socket_errors](#http_log_socket_errors)
	* [http_full_uri_match](#http_full_uri_match)
	* [https](#https)
	* [https_port](#https_port)
	* [https_cert_file](#https_cert_file)
	* [https_key_file](#https_key_file)
	* [https_ca_file](#https_ca_file)
	* [https_force](#https_force)
	* [https_header_detect](#https_header_detect)
	* [https_timeout](#https_timeout)
- [Custom URI Handlers](#custom-uri-handlers)
	* [Access Control Lists](#access-control-lists)
	* [Internal File Redirects](#internal-file-redirects)
	* [Sending Responses](#sending-responses)
		+ [Standard Response](#standard-response)
		+ [Custom Response](#custom-response)
		+ [JSON Response](#json-response)
		+ [Non-Response](#non-response)
	* [args](#args)
		+ [args.request](#argsrequest)
		+ [args.response](#argsresponse)
		+ [args.ip](#argsip)
		+ [args.ips](#argsips)
		+ [args.query](#argsquery)
		+ [args.params](#argsparams)
			- [Standard HTTP POST](#standard-http-post)
			- [JSON REST POST](#json-rest-post)
			- [Unknown POST](#unknown-post)
		+ [args.files](#argsfiles)
		+ [args.cookies](#argscookies)
		+ [args.perf](#argsperf)
		+ [args.server](#argsserver)
	* [Request Filters](#request-filters)
- [Logging](#logging)
- [Stats](#stats)
	* [The Server Object](#the-server-object)
	* [The Stats Object](#the-stats-object)
	* [The Listeners Object](#the-listeners-object)
	* [The Sockets Object](#the-sockets-object)
	* [The Recent Object](#the-recent-object)
	* [The Queue Object](#the-queue-object)
	* [Including Custom Stats](#including-custom-stats)
	* [Stats URI Handler](#stats-uri-handler)
- [Misc](#misc)
	* [Determining HTTP or HTTPS](#determining-http-or-https)
	* [Self-Referencing URLs](#self-referencing-urls)
	* [Custom Method Handlers](#custom-method-handlers)
	* [Let's Encrypt SSL Certificates](#lets-encrypt-ssl-certificates)
	* [Greenlock](#greenlock)
- [License](#license)

# Usage

Use [npm](https://www.npmjs.com/) to install the module:

```
npm install pixl-server pixl-server-web
```

Here is a simple usage example.  Note that the component's official name is `WebServer`, so that is what you should use for the configuration key, and for gaining access to the component via your server object.

```js
var PixlServer = require('pixl-server');
var server = new PixlServer({
	
	__name: 'MyServer',
	__version: "1.0",
	
	config: {
		"log_dir": "/var/log",
		"debug_level": 9,
		
		"WebServer": {
			"http_port": 80,
			"http_htdocs_dir": "/var/www/html"
		}
	},
	
	components: [
		require('pixl-server-web')
	]
	
});

server.startup( function() {
	// server startup complete
	
	server.WebServer.addURIHandler( '/my/custom/uri', 'Custom Name', function(args, callback) {
		// custom request handler for our URI
		callback( 
			"200 OK", 
			{ 'Content-Type': "text/html" }, 
			"Hello this is custom content!\n" 
		);
	} );
} );
```

Notice how we are loading the [pixl-server](https://www.npmjs.com/package/pixl-server) parent module, and then specifying [pixl-server-web](https://www.npmjs.com/package/pixl-server-web) as a component:

```js
components: [
	require('pixl-server-web')
]
```

This example is a very simple web server configuration, which will listen on port 80 and serve static files out of `/var/www/html`.  However, if the URI is `/my/custom/uri`, a custom callback function is fired and can serve up any response it wants.  This is a great way to implement an API.

# Configuration

The configuration for this component is set by passing in a `WebServer` key in the `config` element when constructing the `PixlServer` object, or, if a JSON configuration file is used, a `WebServer` object at the outermost level of the file structure.  It can contain the following keys:

## http_port

This is the port to listen on.  The standard web port is 80, but note that only the root user can listen on ports below 1024.

## http_bind_address

Optionally specify an exact local IP address to bind the listener to.  By default this binds to all available addresses on the machine.  Example:

```js
{
	"http_bind_address": "127.0.0.1"
}
```

This example would cause the server to *only* listen on localhost, and not any external network interface.

## http_htdocs_dir

This is the path to the directory to serve static files out of, e.g. `/var/www/html`.

## http_max_upload_size

This is the maximum allowed upload size.  If uploading files, this is a per-file limit.  If submitting raw data, this is an overall POST content limit.  The default is 32MB.

## http_temp_dir

This is where file uploads will be stored temporarily, until they are renamed or deleted.  If omitted, this defaults to the operating system's temp directory, as returned from `os.tmpDir()`.

## http_static_ttl

This is the TTL (time to live) value to pass on the `Cache-Control` response header.  This causes static files to be cached for a number of seconds.  The default is 0 seconds.

## http_static_index

This sets the filename to look for when directories are requested.  It defaults to `index.html`.

## http_server_signature

This is a string to send back to the client with every request, as the `Server` HTTP response header.  This is typically used to declare the web server software being used.  The default is `WebServer`;

## http_compress_text

This is a boolean indicating whether or not to compress text responses using [zlib](https://nodejs.org/api/zlib.html) software compression in Node.js.  The default is `false`.  The compression format is chosen automatically based on the `Accept-Encoding` request header sent from the client.  The supported formats are Brotli (see [http_enable_brotli](#http_enable_brotli)), Gzip and Deflate, chosen in that order.

You can force compression on an individual response basis, by including a `X-Compress: 1` response header in your URI handler code.  The web server will detect this header and force-enable compression on the data, regardless of the `http_compress_text` or `http_regex_text` settings.  Note that it still honors the client `Accept-Encoding` header, and will only enable compression if this request header is present and contains `gzip`.

**Note:** The legacy `http_gzip_text` property is still supported, and is now a shortcut for `http_compress_text`.

## http_regex_text

This is a regular expression string which is compared against the `Content-Type` response header.  When this matches, and [http_compress_text](#http_compress_text) is enabled, this will kick in compression.  It defaults to `(text|javascript|json|css|html)`.

## http_regex_json

This is a regular expression string used to determine if the incoming POST request contains JSON.  It is compared against the `Content-Type` request header.  The default is `(javascript|js|json)`.

## http_response_headers

This param allows you to send back any additional custom HTTP headers with each response.  Set the param to an object containing keys for each header, like this:

```js
{
	http_response_headers: {
		"X-My-Custom-Header": "12345",
		"X-Another-Header": "Hello"
	}
}
```

## http_timeout

This sets the idle socket timeout for all incoming HTTP requests.  If omitted, the Node.js default is 2 minutes.  Please specify your value in seconds.

## http_keep_alives

This controls the [HTTP Keep-Alive](https://en.wikipedia.org/wiki/HTTP_persistent_connection) behavior in the web server.  There are three possible settings, which should be specified as a string:

### default

```js
{
	"http_keep_alives": "default"
}
```

This **enables** Keep-Alives for all incoming connections by default, unless the client specifically requests a close connection via a `Connection: close` header.

### request

```js
{
	"http_keep_alives": "request"
}
```

This **disables** Keep-Alives for all incoming connections by default, unless the client specifically requests a Keep-Alive connection by passing a `Connection: keep-alive` header.

### close

```js
{
	"http_keep_alives": "close"
}
```

This completely disables Keep-Alives for all connections.  All requests result in the socket being closed after completion, and each socket only serves one single request.

## http_keep_alive_timeout

This sets the HTTP Keep-Alive idle timeout for all sockets.  If omitted, the Node.js default is 5 seconds.  See [server.keepAliveTimeout](https://nodejs.org/api/http.html#http_server_keepalivetimeout) for details.  Example:

```js
{
	"http_keep_alive_timeout": 5000
}
```

This feature was introduced in Node.js version 8.  Prior to that, the [http_timeout](#http_timeout) was used as the Keep-Alive timeout.

## http_max_requests_per_connection

This allows you to set a maximum number of requests to allow per Keep-Alive connection.  It defaults to `0` which means unlimited.  If set, and the maximum is reached, a `Connection: close` header is returned, politely asking the client to close the connection.  It does not actually hard-close the socket.  Example:

```js
{
	"http_max_requests_per_connection": 100
}
```

## http_gzip_opts

This allows you to set various options for the automatic GZip compression in HTTP responses.  Example:

```js
{
	http_gzip_opts: {
		level: 6,
		memLevel: 8
	}
}
```

Please see the Node [Zlib Class Options](https://nodejs.org/api/zlib.html#zlib_class_options) for more details on what can be set here.

## http_enable_brotli

Set this to `true` to enable [Brotli](https://en.wikipedia.org/wiki/Brotli) compression support.  The default is `false` (disabled).  When enabled, and the client advertises support via the `Accept-Encoding` request header, and [http_compress_text](#http_compress_text) is enabled, and the response `Content-Type` matches the [http_regex_text](#http_regex_text) pattern, Brotli will be used.

Brotli is a newer compression format written by Google, which was added to Node.js in v10.16.0.  With careful tuning (see below) you can produce equivalent payload sizes to Gzip but considerably faster (i.e. less CPU), or even up to ~20% smaller sizes than Gzip but much slower (i.e. more CPU).

## http_brotli_opts

If [http_enable_brotli](#http_enable_brotli) is set to `true`, then you can set various options via the `http_brotli_opts` configuration property.  Example:

```js
{
	http_brotli_opts: {
		chunkSize: 16 * 1024,
		mode: "text",
		level: 4,
		hint: 0
	}
}
```

See the Node [Brotli Class Options](https://nodejs.org/api/zlib.html#zlib_class_brotlioptions) for more details on what can be set here.  Note that `mode` is a convenience shortcut for `zlib.constants.BROTLI_PARAM_MODE` (which can set to `text`, `font` or `generic`), `level` is a shortcut for `zlib.constants.BROTLI_PARAM_QUALITY`, and `hint` is a shortcut for `zlib.constants.BROTLI_PARAM_SIZE_HINT`.

## http_default_acl

This allows you to configure the default [ACL](https://en.wikipedia.org/wiki/Access_control_list), which is only used for URI handlers that register themselves as private.  To customize it, specify an array of [IPv4](https://en.wikipedia.org/wiki/IPv4) and/or [IPv6](https://en.wikipedia.org/wiki/IPv6) addresses, partials or [CIDR blocks](https://en.wikipedia.org/wiki/Classless_Inter-Domain_Routing).  It defaults to [localhost](https://en.wikipedia.org/wiki/Localhost) plus the [IPv4 private reserved](https://en.wikipedia.org/wiki/Private_network#Private_IPv4_addresses) and [IPv6 private reserved ranges](https://en.wikipedia.org/wiki/Private_network#Private_IPv6_addresses).  Example:

```js
{
	http_default_acl: ['127.0.0.1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1/128', 'fd00::/8', '169.254.0.0/16', 'fe80::/10']
}
```

See [Access Control Lists](#access-control-lists) below for more details.

## http_log_requests

This boolean allows you to enable transaction logging in the web server.  It defaults to `false`.  See [Logging](#logging) below.

## http_regex_log

If [http_log_requests](#http_log_requests) is enabled, this allows you to specify a regular expression to match against incoming request URIs.  Only if they match will the request be logged.  It defaults to match all URIs (`.+`).  See [Logging](#logging) below for details.

## http_recent_requests

This integer specifies the number of recent requests to provide in the `getStats()` response.  It defaults to `10`.  See [Stats](#stats) below for details.

## http_max_connections

This integer specifies the maximum number of concurrent connections to allow.  It defaults to `0` (no limit).  If specified and the amount is exceeded, new incoming connections will be denied (socket force-closed without reading any data), and an error logged for each attempt (with error code `maxconns`).

## http_max_concurrent_requests

This integer specifies the maximum number of concurrent requests to allow.  It defaults to `0` (no limit).  If more than the maximum allowed requests arrive in parallel, additional requests are queued, and processed as soon as slots become available.  Requests are always processed in the order they were received.

The idea here is that you can set [http_max_connections](#http_max_connections) to a much higher value, for things like load balancers pre-opening connections or clients using a pool of keep-alive connections, but then only allow your application code to process a smaller amount of requests in parallel.  For example:

```js
{
	"http_max_connections": 2048,
	"http_max_concurrent_requests": 64
}
```

This would allow up to 2,048 concurrent connections (sockets) to be open at any given time, but only allow 64 active requests to run in parallel.  If more than 64 requests came in at once, the remainder would be queued up, and processed as soon as other requests completed.

## http_clean_headers

This boolean enables HTTP response header cleansing.  When set to `true` it will strip all illegal characters from your response header values, which otherwise could cause Node.js to crash.  It defaults to `false`.  The regular expression it uses is `/([\x7F-\xFF\x00-\x1F\u00FF-\uFFFF])/g`.

## http_log_socket_errors

This boolean enables logging socket related errors, specifically sockets being closed unexpectedly (i.e. client closed socket, or some network error caused socket to abort).  This defaults to `true`, meaning these will be logged as errors.  If this generates too much log noise for your production stack, you can set the configuration property to `false`, which will only log a level 9 debug event.  Example:

```js
{
	"http_log_socket_errors": false
}
```

Example error log entry:

```
[1545121086.42][2018-12-18 00:18:06][myserver01.mycompany.com][29801][WebServer][error][socket][Socket closed unexpectedly: c43593][][][{"id":"c43593","proto":"http","port":80,"time_start":1545120267519,"num_requests":886,"bytes_in":652041,"bytes_out":1307291,"total_elapsed":818901,"url":"http://mycompany.com/example/url","ips":["1.1.1.1","2.2.2.2"]}]
```

## http_full_uri_match

When this boolean is set to `true`, [Custom URI Handlers](#custom-uri-handlers) will match against the *full* incoming URI, including the query string.  By default this is disabled, meaning URIs are only matched using their path.  Example:

```js
{
	"http_full_uri_match": true
}
```

## https

This boolean allows you to enable HTTPS (SSL) support in the web server.  It defaults to `false`.  Note that you must also set `https_port`, and possibly `https_cert_file` and `https_key_file` for this to work.

Note that if you use [Greenlock](#greenlock) for SSL certificate automation, you can omit `https_cert_file` and `https_key_file`.

## https_port

If HTTPS mode is enabled, this is the port to listen on for secure requests.  The standard HTTPS port is 443.

## https_cert_file

If HTTPS mode is enabled, this should point to your SSL certificate file on disk.  The certificate file typically has a `.crt` filename extension, or possibly `cert.pem` if using [Let's Encrypt](https://letsencrypt.org/).

## https_key_file

If HTTPS mode is enabled, this should point to your SSL private key file on disk.  The key file typically has a `.key` filename extension, or possibly `privkey.pem` if using [Let's Encrypt](https://letsencrypt.org/).

## https_ca_file

If HTTPS mode is enabled, this should point to your SSL chain file on disk.  This is optional, as some SSL certificates do not provide one.  If using [Let's Encrypt](https://letsencrypt.org/) this file will be named `chain.pem`.

## https_force

If HTTPS mode is enabled, you can set this param to boolean `true` to force all requests to be HTTPS.  Meaning, if someone attempts a non-secure plain HTTP request to any URI, their client will be redirected to an equivalent HTTPS URI.

## https_header_detect

Your network architecture may have a proxy server or load balancer sitting in front of the web server, and performing all HTTPS/SSL encryption for you.  Usually, these devices inject some kind of HTTP request header into the back-end web server request, so you can "detect" a front-end HTTPS proxy request in your code.  For example, Amazon AWS load balancers inject the following HTTP request header into all back-end requests:

```
X-Forwarded-Proto: https
```

The `https_header_detect` property allows you to define any number of header regular expression matches, that will "pseudo-enable" SSL mode in the web server.  Meaning, the `args.request.headers.ssl` property will be set to `true`, and calls to `server.getSelfURL()` will have a `https://` prefix.  Here is an example configuration, which detects many commonly used headers:

```js
{
	https_header_detect: {
		"Front-End-Https": "^on$",
		"X-Url-Scheme": "^https$",
		"X-Forwarded-Protocol": "^https$",
		"X-Forwarded-Proto": "^https$",
		"X-Forwarded-Ssl": "^on$"
	}
}
```

Note that these are matched using logical OR, so only one of them needs to match to enable SSL mode.  The values are interpreted as regular expressions, in case you need to match more than one header value.

## https_timeout

This sets the idle socket timeout for all incoming HTTPS requests.  If omitted, the Node.js default is 2 minutes.  Please specify your value in seconds.

# Custom URI Handlers

You can attach your own handler methods for intercepting and responding to certain incoming URIs.  So for example, instead of the URI `/api/add_user` looking for a static file on disk, you can have the web server invoke your own function for handling it, and sending a custom response.  

To do this, call the `addURIHandler()` method and pass in the URI string, a name (for logging), and a callback function:

```js
server.WebServer.addURIHandler( '/my/custom/uri', 'Custom Name', function(args, callback) {
	// custom request handler for our URI
	callback( 
		"200 OK", 
		{ 'Content-Type': "text/html" }, 
		"Hello this is custom content!\n" 
	);
} );
```

URIs must match exactly (sans the query string), and the case is sensitive.  If you need to implement something more complicated, such as a regular expression match, you can pass one of these in as well.  Example:

```js
server.WebServer.addURIHandler( /^\/custom\/match\/$/i, 'Custom2', function(args, callback) {...} );
```

Your handler function is passed exactly two arguments.  First, an `args` object containing all kinds of useful information about the request (see [args](#args) below), and a callback function that you must call when the request is complete and you want to send a response.

If you specified a regular expression with paren groups for the URI, the matches array will be included in the `args` object as `args.matches`.  Using this you can extract your matched groups from the URI, for e.g. `/^\/api\/(\w+)/`.

Note that by default, URIs are only matched on their path portion (i.e. sans query string).  To include the query string in URI matches, set the [http_full_uri_match](#http_full_uri_match) configuration property to `true`.

## Access Control Lists

If you want to restrict access to certain URI handlers, you can specify an [ACL](https://en.wikipedia.org/wiki/Access_control_list) which represents a list of IP address ranges to allow.  To use the [default ACL](#http_default_acl), simply pass `true` as the 3rd argument to `addURIHandler()`, just before your callback.  This flags the URI as private.  Example:

```js
server.WebServer.addURIHandler( /^\/private/, "Private Admin Area", true, function(args, callback) {
	// request allowed
	callback( "200 OK", { 'Content-Type': 'text/html' }, "<h1>Access granted!</h1>\n" );
} );
```

This will protect the handler using the *default ACL*, as specified by the [http_default_acl](#http_default_acl) configuration parameter.  However, if you want to specify a *custom* ACL per handler, simply replace the `true` argument with an array of [IPv4](https://en.wikipedia.org/wiki/IPv4) and/or [IPv6](https://en.wikipedia.org/wiki/IPv6) addresses, partials or [CIDR blocks](https://en.wikipedia.org/wiki/Classless_Inter-Domain_Routing).  Example:

```js
server.WebServer.addURIHandler( /^\/secret/, "Super Secret Area", ['10.0.0.0/8', 'fd00::/8'], function(args, callback) {
	// request allowed
	callback( "200 OK", { 'Content-Type': 'text/html' }, "<h1>Access granted!</h1>\n" );
} );
```

This would only allow requests from either `10.0.0.0/8` (IPv4) or `fd00::/8` (IPv6).

The ACL code scans *all* the IP addresses from the client, including the socket IP and any passed as part of HTTP headers (populated by load balancers, proxies, etc.).  See [args.ips](#argsips) for more details on this.  All the IPs must pass the ACL test in order for the request to be allowed through to your handler.

If a request is rejected, your handler isn't even called.  Instead, a standard `HTTP 403 Forbidden` response is sent to the client, and an error is logged.

## Internal File Redirects

To setup an internal file redirect, you can substitute the final callback function for a string, pointing to a fully-qualified filesystem path.  The target file will be served up in place of the original URI.  You can also combine this with an ACL for extra protection for private files.  Example:

```js
server.WebServer.addURIHandler( /^\/secret.txt$/, "Special Secrets", true, '/private/myapp/docs/secret.txt' );
```

Note that the `Content-Type` response header is automatically set based on the target file you are redirecting to.

## Sending Responses

There are actually four different ways you can send an HTTP response.  They are all detailed below:

### Standard Response

The first type of response is shown above, and that is passing three arguments to the callback function.  The HTTP response status line (e.g. `200 OK` or `404 File Not Found`), a response headers object containing key/value pairs for any custom headers you want to send back (will be combined with the default ones), and finally the content body.  Example:

```js
callback( 
	"200 OK", 
	{ 'Content-Type': "text/html" }, 
	"Hello this is custom content!\n" 
);
```

The content body can be a string, a [Buffer](https://nodejs.org/api/buffer.html) object, or a [readable stream](https://nodejs.org/api/stream.html#stream_class_stream_readable).

### Custom Response

The second type of response is to send content directly to the underlying Node.js server by yourself, using `args.response` (see below).  If you do this, you can pass `true` to the callback function, indicating to the web server that you "handled" the response, and it shouldn't do anything else.  Example:

```js
server.WebServer.addURIHandler( '/my/custom/uri', 'Custom Name', function(args, callback) {
	// send custom raw response
	var response = args.response;
	response.writeHead( 200, "OK", { 'Content-Type': "text/html" } );
	response.write( "Hello this is custom content!\n" );
	response.end();
	
	// indicate we are done, and have handled things ourselves
	callback( true );
} );
```

### JSON Response

The third way is to pass a single object to the callback function, which will be serialized to JSON and sent back as an AJAX style response to the client.  Example:

```js
server.WebServer.addURIHandler( '/my/custom/uri', 'Custom Name', function(args, callback) {
	// send custom JSON response
	callback( {
		Code: 0,
		Description: "Success",
		User: { Name: "Joe", Email: "foo@bar.com" }
	} );
} );
```

Typically this is sent as pure JSON with the Content-Type `application/json`.  The raw HTTP response would look something like this:

```
HTTP/1.1 200 OK
Connection: keep-alive
Content-Length: 79
Content-Type: application/json
Date: Sun, 05 Apr 2015 20:58:50 GMT
Server: Test 1.0

{"Code":0,"Description":"Success","User":{"Name":"Joe","Email":"foo@bar.com"}}
```

Now, depending on the request URL's query string, two variants of the JSON response are possible.  First, if there is a `callback` query parameter present, it will be prefixed onto the front of the JSON payload, which will be wrapped in parenthesis, and Content-Type will be switched to `text/javascript`.  This is an AJAX / JSONP style of response, and looks like this, assuming a request URL containing `?callback=myfunc`:

```
HTTP/1.1 200 OK
Connection: keep-alive
Content-Length: 88
Content-Type: text/javascript
Date: Sun, 05 Apr 2015 21:25:49 GMT
Server: Test 1.0

myfunc({"Code":0,"Description":"Success","User":{"Name":"Joe","Email":"foo@bar.com"}});
```

And finally, if the request URL's query string contains both a `callback`, and a `format` parameter set to `html`, the response will be actual HTML (Content-Type `text/html`) with a `<script>` tag embedded containing the JSON and callback wrapper.  This is useful for IFRAMEs which may need to talk to their parent window after a form submission.  Here is an example assuming a request URL containing `?callback=parent.myfunc&format=html`:

```
HTTP/1.1 200 OK
Connection: keep-alive
Content-Length: 151
Content-Type: text/html
Date: Sun, 05 Apr 2015 21:28:48 GMT
Server: Test 1.0

<html><head><script>parent.myfunc({"Code":0,"Description":"Success","User":{"Name":"Joe","Email":"foo@bar.com"}});
</script></head><body>&nbsp;</body></html>
```

### Non-Response

The fourth and final type of response is a non-response, and this is achieved by passing `false` to the callback function.  This indicates to the web server that your code did *not* handle the request, and it should fall back to looking up a static file on disk.  Example:

```js
server.WebServer.addURIHandler( '/my/custom/uri', 'Custom Name', function(args, callback) {
	// we did not handle the request, so tell the web server to do so
	callback( false );
} );
```

Note that there is currently no logic to fallback to other custom URI handlers.  The only fallback logic, if a handler returns false, is to lookup a static file on disk.

To perform an internal file redirect from inside your URI handler code, set the `internalFile` property of the `args` object to your destination filesystem path, then pass `false` to the callback:

```js
server.WebServer.addURIHandler( '/intredir', "Internal Redirect", true, function(args, callback) {
	// perform internal redirect to custom file
	args.internalFile = '/private/myapp/docs/secret.txt';
	callback(false);
} );
```

## args

Your URI handler function is passed an `args` object containing the following properties:

### args.request

This is a reference to the underlying [Node.js server request](https://nodejs.org/api/http.html#http_http_incomingmessage) object.  From this you have access to things like:

| Property | Description |
|----------|-------------|
| `request.httpVersion` | The version of the HTTP protocol used in the request. |
| `request.headers` | An object containing all the HTTP request headers (lower-cased). | 
| `request.method` | The HTTP method used in the request, e.g. `GET`, `POST`, etc. | 
| `request.url` | The complete URI of the request (sans protocol and hostname). | 
| `request.socket` | A reference to the underlying socket connection for the request. | 

For more detailed documentation on the request object, see Node's [http.IncomingMessage](https://nodejs.org/api/http.html#http_http_incomingmessage).

### args.response

This is a reference to the underlying [Node.js server response](https://nodejs.org/api/http.html#http_class_http_serverresponse) object.  From this you have access to things like:

| Property / Method() | Description |
|----------|-------------|
| `response.writeHead()` | This writes the HTTP status code, message and headers to the socket. |
| `response.setTimeout()` | This sets a timeout on the response. |
| `response.statusCode` | This sets the HTTP status code, e.g. 200, 404, etc. |
| `response.statusMessage` | This sets the HTTP status message, e.g. OK, File Not Found, etc. |
| `response.setHeader()` | This sets a single header key / value pair in the response. |
| `response.write()` | This writes a chunk of data to the socket. |
| `response.end()` | This indicates that the response has been completely sent. |

For more detailed documentation on the response object, see Node's [http.ServerResponse](https://nodejs.org/api/http.html#http_class_http_serverresponse).

### args.ip

This will be set to the user's remote IP address.  Specifically, it will be set to the *first public IP address* if multiple addresses are provided via proxy HTTP headers and the socket.

Meaning, if the user is sitting behind one or more proxy servers, *or* your web server is behind a load balancer, this will attempt to locate the user's true public (non-private) IP address.  If none is found, it'll just return the first IP address, honoring proxy headers before the socket (which is usually correct).

If you just want the socket IP by itself, you can get it from `args.request.socket.remoteAddress`.

### args.ips

This will be set to an array of *all* the user's remote IP addresses, taking into account the socket IP and various HTTP headers populated by proxies and load balancers, if applicable.  The header address(es) will come first, if applicable, followed by the socket IP at the end.

The following HTTP headers are scanned for IP addresses to build the `args.ips` array:

| Header | Syntax | Description |
|--------|--------|-------------|
| `X-Forwarded-For` | Comma-Separated | The de-facto standard header for identifying the originating IP address of a client connecting through an HTTP proxy or load balancer.  See [X-Forwarded-For](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For). |
| `Forwarded-For` | Comma-Separated | Alias for `X-Forwarded-For`. |
| `Forwarded` | Custom | New standard header as defined in [RFC 7239](https://tools.ietf.org/html/rfc7239#section-4), with custom syntax.  See [Forwarded](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Forwarded).
| `X-Forwarded` | Custom | Alias for `Forwarded`. |
| `X-Client-IP` | Single | Non-standard, used by Heroku, etc. |
| `CF-Connecting-IP` | Single | Non-standard, used by CloudFlare. |
| `True-Client-IP` | Single | Non-standard, used by Akamai, CloudFlare, etc. |
| `X-Real-IP` | Single | Non-standard, used by Nginx, FCGI, etc. |
| `X-Cluster-Client-IP` | Single | Non-standard, used by Rackspace, Riverbed, etc. |

### args.query

This will be an object containing key/value pairs from the URL query string, if applicable, parsed via the Node.js core [Query String](https://nodejs.org/api/querystring.html) module.

Duplicate query params become an array.  For example, an incoming URI such as `/something?foo=bar1&foo=bar2&name=joe` would produce the following `args.query` object:

```js
{
	"foo": ["bar1", "bar2"],
	"name": "joe"
}
```

### args.params

If the request was a HTTP POST, this will contain all the post parameters as key/value pairs.  This will take one of three forms, depending on the request's `Content-Type` header:

#### Standard HTTP POST

If the request Content-Type was one of the standard `application/x-www-form-urlencoded` or `multipart/form-data`, all the key/value pairs from the post data will be parsed, and provided in the `args.params` object.  We use the 3rd party [Formidable](https://www.npmjs.com/package/formidable) module for this work.

#### JSON REST POST

If the request is a "pure" JSON POST, meaning the Content-Type contains `json` or `javascript`, the content body will be parsed as a single JSON string, and the result object placed into `args.params`.

#### Unknown POST

If the Content-Type doesn't match any of the above values, it will simply be treated as a plain binary data, and a [Buffer](https://nodejs.org/api/buffer.html) will be placed into `args.params.raw`.

### args.files

If the request was a HTTP POST and contained any file uploads, they will be accessible through this property.  Files are saved to a temp directory and can be moved to a custom location, or loaded directly.  They will be keyed by the POST parameter name, and the value will be an object containing the following properties:

| Property | Description |
|----------|-------------|
| `size` | The size of the uploaded file in bytes. |
| `path` | The path to the temp file on disk containing the file contents. |
| `name` | The filename of the file as provided by the client. |
| `type` | The mime type of the file, according to the client. |
| `lastModifiedDate` | A date object containing the last mod date of the file, if available. |

For more details, please see the documentation on the [Formidable.File](https://github.com/felixge/node-formidable#formidablefile) object.

All temp files are automatically deleted at the end of the request.

### args.cookies

This is an object parsed from the incoming `Cookie` HTTP header, if present.  The contents will be key/value pairs for each semicolon-separated cookie provided.  For example, if the client sent in a `session_id` cookie, it could be accessed like this:

```js
var session_id = args.cookies['session_id'];
```

### args.perf

This is a reference to a [pixl-perf](https://www.npmjs.com/package/pixl-perf) object, which is used internally by the web server to track performance metrics for the request.  The metrics may be logged at the end of each request (see [Logging](#logging) below) and included in the stats (see [Stats](#stats) below).

### args.server

This is a reference to the pixl-server object which handled the request.

## Request Filters

Filters allow you to preprocess a request, before any handlers get their hands on it.  They can pass data through, manipulate it, or even interrupt and abort requests.  Filters are attached to particular URIs or URI patterns, and multiple may be applied to one request, depending on your rules.  They can be asynchronous, and can also pass data between one another if desired.

You can attach your own filter methods for intercepting and responding to certain incoming URIs.  So for example, let's say we want to filter the URI `/api/add_user` before the handler gets it, and inject some custom data.  To do this, call the `addURIFilter()` method and pass in the URI string, a name (for logging), and a callback function:

```js
server.WebServer.addURIFilter( /.+/, "My Filter", function(args, callback) {
	// add a nugget into request query
	args.query.filter_nugget = 42;
	
	// add a custom response header too
	args.response.setHeader('X-Filtered', "4242");
	
	callback(false); // passthru
} );
```

So here we are injecting `filter_nugget` into the `args.query` object, which is preserved and passed down to other filters and handlers.  Also, we are adding a `X-Filtered` header to the response (whoever ends up sending it).  Finally, we call the `callback` function passing `false`, which means to pass the request through to other filters and/or handlers (see below for more on this).

URI strings must match exactly (sans the query string), and the case is sensitive.  If you need to match something more complicated, such as a regular expression, you can pass one of these in place of the URI string.  Example:

```js
server.WebServer.addURIFilter( /^\/custom\/match\/$/i, 'Custom2', function(args, callback) {...} );
```

Your filter handler function is passed exactly two arguments.  First, an `args` object containing all kinds of useful information about the request (see [args](#args) above), and a callback function that you must invoke when the filter is complete, and you want to either allow the request to continue, or interrupt it and send your own response.

As shown above, passing `false` to the callback means to pass the request through to downstream filters and handlers.  If you want to intercept and abort the request, and send your own response preventing any further processing, you can pass a [Standard Response](#standard-response) to the callback, i.e. send exactly 3 arguments, an HTTP response code, HTTP response headers, and the response body (or `null`):

```js
server.WebServer.addURIFilter( /.+/, "Reject All", function(args, callback) {
	// intercept everything and send our own custom response
	callback(
		"418 I'm a teapot", 
		{ 'X-Filtered': 42 },
		null
	);
} );
```

This will intercept and abort all requests, sending back a `HTTP 418` error.

To pass data between filters and potentially handlers, simply add properties into the `args` object.  This object is preserved for the lifetime of the request, and the same object reference is passed to all filters and handlers.  Just be careful of namespace collisions with existing properties in the object.  See [args](#args) above for details.

# Logging

In addition to the standard debug logging in pixl-server, the web server component can also log each request as a `transaction`.  This is an optional feature which is disabled by default.  To enable it, set the [http_log_requests](#http_log_requests) configuration property to `true`.  The pixl-server log will then include a `transaction` row for every completed web request.  Example:

```
[1466210619.37][2016/06/17 17:43:39][joeretina.local][WebServer][transaction][HTTP 200 OK][/server-status?pretty=1][{"proto":"http","ips":["::ffff:127.0.0.1"],"host":"127.0.0.1:3012","ua":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/601.6.17 (KHTML, like Gecko) Version/9.1.1 Safari/601.6.17","perf":{"scale":1000,"perf":{"total":10.266,"read":0.256,"process":1.077,"write":7.198},"counters":{"bytes_in":587,"bytes_out":431,"num_requests":1}}}]
```

The log columns are configurable in pixl-server, but are typically the following:

| Column | Name | Description |
|--------|------|-------------|
| 1 | `hires_epoch` | Epoch date/time, including milliseconds (floating point). |
| 2 | `date` | Human-readable date/time, in the local server timezone. |
| 3 | `hostname` | The hostname of the server. |
| 4 | `component` | The server component name (`WebServer`). |
| 5 | `category` | The category of the log entry (`transaction`). |
| 6 | `code` | The HTTP response code and message, e.g. `HTTP 200 OK`. |
| 7 | `msg` | The URI of the request. |
| 8 | `data` | A JSON document containing data about the request. |

The `data` column is a JSON document containing various bits of additional information about the request.  Here is a formatted example:

```js
{
	"proto": "http",
	"ips": [
		"::ffff:127.0.0.1"
	],
	"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/601.6.17 (KHTML, like Gecko) Version/9.1.1 Safari/601.6.17",
	"host": "localhost",
	"perf": {
		"scale": 1000,
		"perf": {
			"total": 8.041,
			"read": 0.077,
			"process": 1.315,
			"write": 5.451
		},
		"counters": {
			"bytes_in": 587,
			"bytes_out": 639,
			"num_requests": 1
		}
	}
}
```

Here are descriptions of the data JSON properties:

| Property | Description |
|----------|-------------|
| `proto` | The protocol of the request (`http` or `https`). |
| `ips` | All the client IPs as an array (includes those from proxy headers). |
| `ua` | The `User-Agent` string from the request headers. |
| `host` | The hostname from the request URL. |
| `perf` | Performance metrics, see below. |

The `perf` object contains performance metrics for the request, as returned from the [pixl-perf](https://www.npmjs.com/package/pixl-perf) module.  It includes a `scale` property denoting that all the metrics are displayed in milliseconds (i.e. `1000`).  The metrics themselves are in the `perf` object, and counters such as the number of bytes in/out are in the `counters` object.

If you only want to log *some* requests, but not all of them, you can specify a regular expression in the [http_regex_log](#http_regex_log) configuration property, which is matched against the incoming request URIs.  Example:

```js
{
	"http_regex_log": "^/my/special/path"
}
```

# Stats

The web server keeps internal statistics including all open sockets, all active and recently completed requests, and performance metrics.  You can query for these by calling the `getStats()` method on the web server component.  Example:

```js
	var stats = server.WebServer.getStats();
```

The result is an object in this format:

```js
{
	"server": {
		"uptime": 80,
		"hostname": "joeretina.local",
		"ip": "10.1.10.247",
		"name": "MyServer",
		"version": "1.0"
	},
	"stats": {
		"total": {
			"st": "mma",
			"min": 0.479,
			"max": 2.57,
			"total": 11.3748,
			"count": 11
		},
		"read": {
			"st": "mma",
			"min": 0.005,
			"max": 0.071,
			"total": 0.170,
			"count": 11
		},
		"process": {
			"st": "mma",
			"min": 0.123,
			"max": 0.625,
			"total": 2.691,
			"count": 11
		},
		"write": {
			"st": "mma",
			"min": 0.313,
			"max": 1.747,
			"total": 7.679,
			"count": 11
		},
		"bytes_out": 1175,
		"num_requests": 11,
		"bytes_in": 0
	},
	"listeners": {
		"http": {
			"address": "::",
			"family": "IPv6",
			"port": 80
		}
	},
	"sockets": {
		"c109": {
			"state": "idle",
			"ip": "::ffff:127.0.0.1",
			"proto": "http",
			"port": 80,
			"uptime_ms": 70315,
			"elapsed_ms": 5.343,
			"num_requests": 1,
			"bytes_in": 172,
			"bytes_out": 3869
		},
		"c110": {
			"state": "processing",
			"ip": "::ffff:127.0.0.1",
			"proto": "http",
			"port": 80,
			"uptime_ms": 1.23,
			"elapsed_ms": 0.280054,
			"num_requests": 38,
			"bytes_in": 0,
			"bytes_out": 14659,
			"ips": [
				"::ffff:127.0.0.1"
			],
			"method": "GET",
			"uri": "/server-status?pretty=1",
			"host": "localhost"
		}
	},
	"recent": [
		{
			"when": 1466203237,
			"proto": "http",
			"port": 80,
			"code": 200,
			"status": "OK",
			"uri": "/rimfire/native",
			"host": "localhost",
			"ips": [
				"::ffff:127.0.0.1"
			],
			"ua": "libwww-perl/6.08",
			"perf": {
				"scale": 1000,
				"perf": {
					"total": 2.403,
					"read": 0.02,
					"process": 0.281,
					"write": 2.026
				},
				"counters": {
					"bytes_in": 131,
					"bytes_out": 190,
					"num_requests": 1
				}
			}
		}
	],
	"queue": {
		"pending": 0,
		"running": 1
	}
}
```

## The Server Object

The `server` object contains information about the server as a whole.  The properties include:

| Property | Type | Description |
|----------|------|-------------|
| `hostname` | String | The hostname of the server. |
| `ip` | String | The local IP address of the server. |
| `name` | String | The name of your pixl-server instance. |
| `version` | String | The version of your pixl-server instance. |
| `uptime` | Integer | The number of seconds since the server was started. |

## The Stats Object

The `stats` object contains real-time performance metrics, representing one whole second of time.  Your server will need to have a constant flow of requests for this to actually show any meaningful data.  The properties include:

| Property | Type | Description |
|----------|------|-------------|
| `total` | Min/Max/Avg | Total request elapsed time. |
| `read` | Min/Max/Avg | Total request read time. |
| `process` | Min/Max/Avg | Total request process time (i.e. custom URI handler). |
| `write` | Min/Max/Avg | Total request write time. |
| `bytes_in` | Simple Counter | Total bytes received in the last full second. |
| `bytes_out` | Simple Counter | Total sent in the last full second. |
| `num_requests` | Simple Counter | Total requests served in the last full second. |

The object consists of both simple counters, and min/max/avg objects.  The latter is designed to represent specific performance metrics, and we include the minimum, maximum, and a count and total (for computing the average).  Simply divide the total by the count and you'll have the average over the 1.0 seconds of sample time.

The min/max/avg objects are all tagged with an `st` (stat type) key set to `mma` (min/max/avg).  This is simply an identifier for libraries wanting to display or graph the data.

If you add any of your own app's performance metrics via `args.perf`, they will be included in this object as well.  See [Including Custom Stats](#including-custom-stats) below for details.

## The Listeners Object

The `listeners` object contains information about the socket listeners currently open and receiving connections.  There may be one or two of these, depending on if HTTPS/SSL is enabled.  The `listeners` object will contain `http` and/or `https` sub-objects, each with the following properties:

| Property | Type | Description |
|----------|------|-------------|
| `address` | String | The bound local IP address, or `::` for wildcard IPv6 or `0.0.0.0` for wildcard IPv4 (i.e. all network interfaces). |
| `port` | Integer | The local port number we are listening on. |
| `family` | String | The IP family, will be one of `IPv6` or `IPv4`. |

## The Sockets Object

The `sockets` object contains information about all currently open sockets.  Note that this is an object, not an array.  The keys are internal identifiers, and the values are sub-objects containing the following properties:

| Property | Type | Description |
|----------|------|-------------|
| `state` | String | The current state of the socket, will be one of: `idle`, `reading`, `processing`, or `writing`. |
| `ip` | String | The client IP address connected to the socket (may be a load balancer or proxy). |
| `proto` | String | The protocol of the socket, will be `http` or `https`. |
| `port` | Integer | The listening port of the socket, e.g. `80` or `443`. |
| `uptime_ms` | Number | The total time the socket has been connected, in milliseconds. |
| `num_requests` | Integer | The total number of requests served by the socket (i.e. keep-alives). |
| `bytes_in` | Integer | The total number of bytes received by the socket. |
| `bytes_out` | Integer | The total number of bytes sent by the socket. |
| `elapsed_ms` | Number | If an HTTP request is in progress, this will contain the elapsed request time, in milliseconds. |
| `ips` | Array | If an HTTP request is in progress, this will contain the array of client IPs, including proxy IPs. |
| `method` | String | If an HTTP request is in progress, this will contain the request method (e.g. `GET`, `POST`, etc.) |
| `uri` | String | If an HTTP request is in progress, this will contain the full request URI. |
| `host` | String | If an HTTP request is in progress, this will contain the hostname from the URL. |

## The Recent Object

The `recent` array is a sorted list of the last 10 completed requests (most recent first).  Each element of the array is an object containing the following properties:

| Property | Type | Description |
|----------|------|-------------|
| `when` | Integer | The date/time of the *completion* of the request, as high-res Epoch seconds. |
| `proto` | String | The protocol of the original client request, will be `http` or `https`. |
| `port` | Integer | The listening port of the socket, e.g. `80` or `443`. |
| `code` | Integer | The HTTP response code, e.g. `200` or `404`. |
| `status` | String | The HTTP response status message, e.g. `OK` or `File Not Found`. |
| `uri` | String | The full request URI including query string. |
| `host` | String | The hostname from the request URL. |
| `ips` | Array | The array of client IPs, including proxy IPs. |
| `ua` | String | The client's `User-Agent` string. |
| `perf` | Object | A [pixl-perf](https://www.npmjs.com/package/pixl-perf) performance metrics object containing stats for the request. |

If you would like more than 10 requests, set the [http_recent_requests](#http_recent_requests) configuration property to the number you want.

## The Queue Object

The `queue` object contains information about the request queue.  This includes the number of current active requests running in parallel, and the number of queued requests waiting to be processed.  The latter is only used if [http_max_concurrent_requests](#http_max_concurrent_requests) is non-zero.  Here are the queue object properties:

| Property | Type | Description |
|----------|------|-------------|
| `pending` | Integer | The number of requests queued, waiting for processing.  Only used if [http_max_concurrent_requests](#http_max_concurrent_requests) is non-zero. |
| `running` | Integer | The number of active requests currently being processed in parallel. |

## Including Custom Stats

To include your own application-level metrics in the `getStats()` output, a [pixl-perf](https://www.npmjs.com/package/pixl-perf) performance tracker is made available to your URI handler code via `args.perf`.  you can call `begin()` and `end()` on this object directly, to measure your own operations:

```js
server.WebServer.addURIHandler( '/my/custom/uri', 'Custom Name', function(args, callback) {
	// custom request handler for our URI
	
	args.perf.begin('db_query');
	// Run DB query here
	args.perf.end('db_query');
	args.perf.count('my_counter', 1);
	
	callback( 
		"200 OK", 
		{ 'Content-Type': "text/html" }, 
		"Hello this is custom content!\n" 
	);
} );
```

Please do not call `begin()` or `end()` without arguments, as that will mess up the existing performance tracking.  Also, make sure you prefix your perf keys so you don't collide with the built-in ones.

Alternatively, you can use your own private [pixl-perf](https://www.npmjs.com/package/pixl-perf) object, and then "import" it into the `args.perf` object at the very end of your handler code, just before you fire the callback.  Example:

```js
my_perf.end();
args.perf.import( my_perf, "app_" );
```

This would import all your metrics and prefix the keys with `app_`.

See the [pixl-perf](https://www.npmjs.com/package/pixl-perf) documentation for more details on how to use the tracker.

## Stats URI Handler

If you want to expose the `getStats()` object as a JSON web service, doing so is very easy.  Just register a URI handler via `addURIHandler()`, and pass the `getStats()` return value to the callback.  Example:

```js
server.WebServer.addURIHandler( '/server-status', "Server Status", true, function(args, callback) {
	callback( server.WebServer.getStats() );
} );
```

It is recommended that you lock this service down via ACL, as you probably don't want to expose it to the world.  See the [Access Control Lists](#access-control-lists) section for details on using ACLs in your handlers.

# Misc

## Determining HTTP or HTTPS

To determine if a request is HTTP or HTTPS, check to see if there is an `args.request.headers.ssl` property.  If this is set to a `true` value, then the request was sent in via HTTPS, otherwise you can assume it was HTTP.

Please note that if you have a load balancer or other proxy handling HTTPS / SSL for you, the final request to the web server may not be HTTPS.  To determine if the *original* request from the client was HTTPS, you may need to sniff for a particular request header, e.g. `X-Forwarded-Proto: https` (used by Amazon's ELB).

See the [https_header_detect](#https_header_detect) configuration property for an automatic way to handle this.

## Self-Referencing URLs

To build a URL that points at the current server, call `server.getSelfURL()` and pass in the `args.request` object.  This will produce a URL using the same protocol as the request (HTTP or HTTPS), the same hostname used on the request, and the port number if applicable.  By default, the URL will point to the root path (`/`).  Example:

```js
var url = server.getSelfURL(args.request);
```

You can optionally pass in a URI path as the second argument.  For example, to build a URL to the exact request URI that came in, pass in `args.request.url` as the second argument:

```js
var url = server.getSelfURL(args.request, args.request.url);
```

## Custom Method Handlers

You can also register a handler that is invoked for every single request for a given request method (i.e. `GET`, `POST`, `HEAD`, `OPTIONS`, etc.).  So instead of matching on the URI, this matches *all* requests for a specific method.  Method handlers are matched first, before URIs are checked.  

To use this, call the server `addMethodHandler()` method, and pass in the method name, title (for logging), and a callback function.  One potential use of this is to capture `OPTIONS` requests, which browsers send in for [CORS AJAX Preflights](https://developer.mozilla.org/en-US/docs/Web/HTTP/Access_control_CORS).  Example:

```js
server.WebServer.addMethodHandler( "OPTIONS", "CORS Preflight", function(args, callback) {
	// handler for HTTP OPTIONS calls (CORS AJAX preflight)
	callback( "200 OK", 
		{
			'Access-Control-Allow-Origin': args.request.headers['origin'] || "*",
			'Access-Control-Allow-Methods': "POST, GET, HEAD, OPTIONS",
			'Access-Control-Allow-Headers': args.request.headers['access-control-request-headers'] || "*",
			'Access-Control-Max-Age': "1728000",
			'Content-Length': "0"
		},
		null
	);
} );
```

## Let's Encrypt SSL Certificates

Here are instructions for using [Let's Encrypt](https://letsencrypt.org/) SSL certificates with pixl-server-web, specifically how to get your certificate issued and how to setup automatic renewal.

The first thing you should do is make sure your server has a public IP address, and point your domain name to it using a DNS "A" record.  For these examples I will be using the domain `mydomain.com`.

Next, you will need to manually install [certbot](https://certbot.eff.org) on your server.  The easiest way to do this is to use the wrapper script [certbot-auto](https://certbot.eff.org/docs/install.html#certbot-auto), like this:

```sh
mkdir -p /usr/local/bin
curl -s https://dl.eff.org/certbot-auto > /usr/local/bin/certbot-auto
chmod a+x /usr/local/bin/certbot-auto
```

We'll be using the [Webroot](https://certbot.eff.org/docs/using.html#webroot) method for authorization.  Make sure you have a web server running on your server and listening on port 80 (only plain HTTP is required at this point).  Assuming your web server's document root path is `/var/www/html` issue this command:

```sh
/usr/local/bin/certbot-auto certonly --webroot -w /var/www/html -d mydomain.com
```

If you need certificates for multiple subdomains, you can add them to the end of the command, delimited by spaces, e.g. `-d mydomain.com www.mydomain.com`.

Then follow the instructions on the console.  Certbot will ask you a number of questions including asking you for your e-mail address, accepting terms of service, etc.  When you are done, you should see a success message like this:

```
IMPORTANT NOTES:
 - Congratulations! Your certificate and chain have been saved at:
   /etc/letsencrypt/live/mydomain.com/fullchain.pem
   Your key file has been saved at:
   /etc/letsencrypt/live/mydomain.com/privkey.pem
   Your cert will expire on 2019-06-19. To obtain a new or tweaked
   version of this certificate in the future, simply run certbot-auto
   again. To non-interactively renew *all* of your certificates, run
   "certbot-auto renew"
 - Your account credentials have been saved in your Certbot
   configuration directory at /etc/letsencrypt. You should make a
   secure backup of this folder now. This configuration directory will
   also contain certificates and private keys obtained by Certbot so
   making regular backups of this folder is ideal.
 - If you like Certbot, please consider supporting our work by:

   Donating to ISRG / Let's Encrypt:   https://letsencrypt.org/donate
   Donating to EFF:                    https://eff.org/donate-le
```

Your SSL certificates are now ready to use in pixl-server-web.  Simply add the following properties to your `WebServer` configuration object, replacing `mydomain.com` with your own domain name:

```js
"https": true,
"https_port": 443,
"https_cert_file": "/etc/letsencrypt/live/mydomain.com/cert.pem",
"https_key_file": "/etc/letsencrypt/live/mydomain.com/privkey.pem",
"https_ca_file": "/etc/letsencrypt/live/mydomain.com/chain.pem"
```

Then start your server as root and it should accept `https://` requests on port 443.

The final step is to make sure your certificates auto-renew before they expire (every 90 days).  The `certbot-auto` command takes care of this, but we have to take care of invoking it ourselves, i.e. from a [crontab](https://en.wikipedia.org/wiki/Cron).  It is recommended that you run the command every night, noting that it takes no action unless your certificates are about to expire (i.e. within 30 days).

If your certificates were renewed, you will also need to restart pixl-server-web.  The `certbot-auto` command can also do this for you, using a special `--post-hook` command-line argument.  Example:

```sh
/usr/local/bin/certbot-auto renew --post-hook "/opt/myapp/bin/control.sh restart"
```

Toss that command into a shell script in `/etc/cron.daily/` and it'll run daily at 4 AM local server time.  Note that the command does produce output, even if your certs are not renewed, so you may want to silence it:

```sh
/usr/local/bin/certbot-auto renew --post-hook "/opt/myapp/bin/control.sh restart" >/dev/null 2>&1
```

Certbot produces its own log file here: `/var/log/letsencrypt/letsencrypt.log`

## Greenlock

pixl-server-web includes support for [Greenlock](https://www.npmjs.com/package/greenlock), which provides free, fully automated HTTPS certificates issued by [Let's Encrypt](https://letsencrypt.org/).  It handles auto-renewal as well, however in my experience this only works some of the time.

To use Greenlock with pixl-server-web, first you have to install the [greenlock-express](https://www.npmjs.com/package/greenlock-express) module.  We don't include this by default because it greatly expands the dependency tree, including some binary C++ modules (yuck).

```
npm install greenlock-express
```

Next, make sure you enable the [https](#https) configuration option, and set a [port](#https_port) (you do *not* have to set [https_cert_file](#https_cert_file) or [https_key_file](#https_key_file) when using Greenlock).

```js
{
	"https": true,
	"https_port": 443
}
```

Finally, include a `greenlock` object in your configuration (alongside the `https` property), and fill it with all the required Greenlock parameters:

```js
{
	"greenlock": {
		"version": "draft-11",
		"server": "https://acme-v02.api.letsencrypt.org/directory",
		"configDir": "/opt/yourapp/conf/certs",
		"approvedDomains": [ "mydomain.com", "www.mydomain.com" ],
		"email": "me@mydomain.com",
		"agreeTos": true,
		"communityMember": false,
		"telemetry": false
	}
}
```

Make sure you follow all the instructions on the [Greenlock](https://www.npmjs.com/package/greenlock-express) module website, because everything has to be perfect, and there are a number of [non-obvious gotchas](https://www.npmjs.com/package/greenlock-express#what-if-the-example-didnt-work).

# License

**The MIT License (MIT)**

*Copyright (c) 2015 - 2019 Joseph Huckaby.*

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
