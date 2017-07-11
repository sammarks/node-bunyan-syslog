// Copyright 2013 Mark Cavage, Inc.  All rights reserved.

var dgram = require('dgram');
var os = require('os');
var Stream = require('stream').Stream;
var util = require('util');

var assert = require('assert-plus');

var binding = require('../build/Release/syslog');



///--- Globals

var sprintf = util.format;

var HOSTNAME = os.hostname();

// Harcoded from https://github.com/trentm/node-bunyan so this module
// can have minimal dependencies
var bunyan = {
        FATAL: 60,
        ERROR: 50,
        WARN:  40,
        INFO:  30,
        DEBUG: 20,
        TRACE: 10,

        safeCycles: function safeCycles() {
                var seen = [];
                function bunyanCycles(k, v) {
                        if (!v || typeof (v) !== 'object') {
                                return (v);
                        }
                        if (seen.indexOf(v) !== -1) {
                                return ('[Circular]');
                        }
                        seen.push(v);
                        return (v);
                }

                return (bunyanCycles);
        }
};


// Syslog Levels
var LOG_EMERG = 0;
var LOG_ALERT = 1;
var LOG_CRIT = 2;
var LOG_ERR = 3;
var LOG_WARNING = 4;
var LOG_NOTICE = 5;
var LOG_INFO = 6;
var LOG_DEBUG = 7;


///--- Helpers

// Translates a Bunyan level into a syslog level
function level(l) {
        switch (l) {
        case bunyan.FATAL:
                return LOG_EMERG;
        case bunyan.ERROR:
                return LOG_ERR;
        case bunyan.WARN:
                return LOG_WARNING;
        case bunyan.INFO:
                return LOG_INFO;
        default:
                return LOG_DEBUG;
        }
}


function levelText(l) {
        switch (l) {
        case bunyan.FATAL:
                return '\x1b[31mFatal:\x1b[39m '
        case bunyan.ERROR:
                return '\x1b[31mError:\x1b[39m '
        case bunyan.WARN:
                return '\x1b[33mWarning:\x1b[39m '
        case bunyan.INFO:
                return '\x1b[32mInfo:\x1b[39m '
        default:
                return '\x1b[37mDebug:\x1b[39m '
        }
}


function time(t) {
        if (t) {
                return new Date(t).toJSON();
        } else {
                return new Date().toJSON();
        }
}



///--- API

function SyslogStream(opts) {
        assert.object(opts, 'options');
        assert.optionalNumber(opts.facility, 'options.facility');
        assert.optionalString(opts.name, 'options.name');

        Stream.call(this);

        this.facility = opts.facility || 1;
        this.name = opts.name || process.title || process.argv[0];
        this.writable = true;

        if (this.constructor.name === 'SyslogStream') {
                binding.openlog(this.name, binding.LOG_CONS, 0);
                process.nextTick(this.emit.bind(this, 'connect'));
        }
}
util.inherits(SyslogStream, Stream);
module.exports = SyslogStream;


// Overriden by TCP/UDP
SyslogStream.prototype.close = function close() {
        binding.closelog();
};


SyslogStream.prototype.destroy = function destroy() {
        this.writable = false;
        this.close();
};


SyslogStream.prototype.end = function end() {
        if (arguments.length > 0)
                this.write.apply(this, Array.prototype.slice.call(arguments));

        this.writable = false;
        this.close();
};


SyslogStream.prototype.write = function write(r) {
        if (!this.writable)
                throw new Error('SyslogStream has been ended already');

        var h;
        var l;
        var m;
        var t;

        if (Buffer.isBuffer(r)) {
                // expensive, but not expected
                m = r.toString('utf8');
        } else if (typeof (r) === 'object') {
                h = r.hostname;
                l = level(r.level);
                m = levelText(r.level);
                t = time(r.time);
                m += r.msg;
                if (r.tag) {
                  m += ' [tag=' + r.tag + ']';
                }
        } else if (typeof (r) === 'string') {
                m = r;
        } else {
                throw new TypeError('record (Object) required');
        }

        l = (this.facility * 8) + (l !== undefined ? l : level(bunyan.INFO));
        var hdr = sprintf('<%d>%s %s %s[%d]:',
                          l,
                          (t || time()),
                          (h || HOSTNAME),
                          r.name + '-' + r.env,
                          process.pid);

        if (this._send) {
                this._send(hdr + m);
        } else {
                binding.syslog(l, m);
        }
};


SyslogStream.prototype.toString = function toString() {
        var str = '[object SyslogStream<facility=' + this.facility;
        if (this.host)
                str += ', host=' + this.host;
        if (this.port)
                str += ', port=' + this.port;
        if (!/^Sys/.test(this.constructor.name)) {
                str += ', proto=' +
                        (/UDP/.test(this.constructor.name) ? 'udp' : 'tcp');
        }
        str += '>]';

        return (str);
};
