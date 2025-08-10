// Simple HTTP / HTTPS Web Server
// A component for the pixl-server daemon framework.
// Copyright (c) 2015 - 2025 Joseph Huckaby
// Released under the MIT License

module.exports = class Args {
	
	constructor(args = {}) {
		// import k/v pairs
		for (var key in args) this[key] = args[key];
	}
	
	setCookie(name, value, opts) {
		// set cookie in response headers
		// opts: { maxAge?, expires?, domain?, path?, secure?, httpOnly?, sameSite? }
		const res = this.response;
		const enc = (s) => encodeURIComponent(s);
		const parts = [`${enc(name)}=${value === '' ? '' : enc(value)}`];
		
		// serialize cookie to string
		if (opts.maxAge != null) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
		if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
		if (opts.domain) parts.push(`Domain=${opts.domain}`);
		parts.push(`Path=${opts.path || '/'}`);
		if (opts.secure) {
			if (opts.secure === 'auto') {
				if (this.request.headers.ssl) parts.push('Secure');
			}
			else parts.push('Secure');
		}
		if (opts.httpOnly !== false) parts.push('HttpOnly'); // default on
		if (opts.sameSite) {
			const ss = String(opts.sameSite).toLowerCase();
			const token = ss === 'strict' ? 'Strict' : ss === 'none' ? 'None' : 'Lax';
			parts.push(`SameSite=${token}`);
		} else {
			parts.push('SameSite=Lax');
		}
		const cookieStr = parts.join('; ');
		
		// append to previous set-cookie or set as solo header
		const prev = res.getHeader('Set-Cookie');
		if (!prev) res.setHeader('Set-Cookie', cookieStr);
		else if (Array.isArray(prev)) res.setHeader('Set-Cookie', prev.concat(cookieStr));
		else res.setHeader('Set-Cookie', [prev, cookieStr]);
	}
	
};
