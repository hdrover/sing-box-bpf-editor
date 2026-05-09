const BPF = (() => {
    const MESSAGE_TYPE_PROFILE_CONTENT = 3;
    const VERSION_CURRENT = 1;
    const PROFILE_TYPE = Object.freeze({LOCAL: 0, ICLOUD: 1, REMOTE: 2});

    const utf8 = new TextDecoder("utf-8", {fatal: false});
    const utf8Enc = new TextEncoder();

    class Reader {
        constructor(bytes) {
            this.bytes = bytes;
            this.offset = 0;
        }

        _need(n) {
            if (this.offset + n > this.bytes.length) {
                throw new Error("Truncated profile payload.");
            }
        }

        readByte() {
            this._need(1);
            return this.bytes[this.offset++];
        }

        readBytes(n) {
            this._need(n);
            const slice = this.bytes.subarray(this.offset, this.offset + n);
            this.offset += n;
            return slice;
        }

        readUvarint() {
            let result = 0;
            let shift = 0;
            while (true) {
                const b = this.readByte();
                result += (b & 0x7f) * Math.pow(2, shift);
                if ((b & 0x80) === 0) break;
                shift += 7;
                if (shift > 56) throw new Error("uvarint too long");
            }
            return result;
        }

        readInt32BE() {
            const b = this.readBytes(4);
            return new DataView(b.buffer, b.byteOffset, 4).getInt32(0, false);
        }

        skip(n) {
            this._need(n);
            this.offset += n;
        }

        readString() {
            const len = this.readUvarint();
            return utf8.decode(this.readBytes(len));
        }
    }

    class Writer {
        constructor() {
            this.parts = [];
            this.length = 0;
        }

        _push(arr) {
            this.parts.push(arr);
            this.length += arr.length;
        }

        writeByte(b) {
            this._push(new Uint8Array([b & 0xff]));
        }

        writeBytes(bs) {
            this._push(bs);
        }

        writeUvarint(v) {
            const bytes = [];
            let n = v;
            while (n >= 0x80) {
                bytes.push((n & 0x7f) | 0x80);
                n = Math.floor(n / 128);
            }
            bytes.push(n & 0xff);
            this._push(new Uint8Array(bytes));
        }

        writeInt32BE(v) {
            const buf = new ArrayBuffer(4);
            new DataView(buf).setInt32(0, v | 0, false);
            this._push(new Uint8Array(buf));
        }

        writeInt64BEZero() {
            this._push(new Uint8Array(8));
        }

        writeString(s) {
            const bs = utf8Enc.encode(s);
            this.writeUvarint(bs.length);
            this._push(bs);
        }

        toUint8Array() {
            const out = new Uint8Array(this.length);
            let off = 0;
            for (const p of this.parts) {
                out.set(p, off);
                off += p.length;
            }
            return out;
        }
    }

    async function gunzip(bytes) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        const buf = await new Response(stream).arrayBuffer();
        return new Uint8Array(buf);
    }

    async function gzipCompress(bytes) {
        const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
        const buf = await new Response(stream).arrayBuffer();
        return new Uint8Array(buf);
    }

    async function decode(bytes) {
        if (!(bytes instanceof Uint8Array)) {
            throw new Error("decode: input must be a Uint8Array.");
        }
        if (bytes.length < 2) {
            throw new Error("File is too small to be a .bpf profile.");
        }
        const messageType = bytes[0];
        if (messageType !== MESSAGE_TYPE_PROFILE_CONTENT) {
            throw new Error(`Unexpected message type 0x${messageType.toString(16)}; expected a profile content message.`);
        }
        const version = bytes[1];
        if (version > VERSION_CURRENT) {
            throw new Error(`Unsupported profile version ${version}.`);
        }

        let payload;
        try {
            payload = await gunzip(bytes.subarray(2));
        } catch (e) {
            throw new Error("Failed to decompress profile payload (not a valid .bpf file?).");
        }

        const r = new Reader(payload);
        const name = r.readString();
        const type = r.readInt32BE();

        if (type === PROFILE_TYPE.ICLOUD) {
            throw new Error("iCloud profiles are not supported by this editor.");
        }
        if (type !== PROFILE_TYPE.LOCAL && type !== PROFILE_TYPE.REMOTE) {
            throw new Error(`Unknown profile type ${type}.`);
        }

        const config = r.readString();

        let remotePath = "";
        let autoUpdate = false;
        let autoUpdateInterval = 0;

        if (type !== PROFILE_TYPE.LOCAL) {
            remotePath = r.readString();
        }

        if (type === PROFILE_TYPE.REMOTE || (version === 0 && type !== PROFILE_TYPE.LOCAL)) {
            autoUpdate = r.readByte() !== 0;
            if (version >= 1) {
                autoUpdateInterval = r.readInt32BE();
            }
            r.skip(8);
        }

        return {name, type, config, remotePath, autoUpdate, autoUpdateInterval};
    }

    async function encode(profile) {
        const {name, type, config} = profile;

        if (type !== PROFILE_TYPE.LOCAL && type !== PROFILE_TYPE.REMOTE) {
            throw new Error(`encode: unsupported profile type ${type}.`);
        }

        const w = new Writer();
        w.writeString(name || "");
        w.writeInt32BE(type);
        w.writeString(config || "");

        if (type !== PROFILE_TYPE.LOCAL) {
            w.writeString(profile.remotePath || "");
        }

        if (type === PROFILE_TYPE.REMOTE) {
            w.writeByte(profile.autoUpdate ? 1 : 0);
            w.writeInt32BE(profile.autoUpdateInterval | 0);
            w.writeInt64BEZero();
        }

        const compressed = await gzipCompress(w.toUint8Array());
        const out = new Uint8Array(2 + compressed.length);
        out[0] = MESSAGE_TYPE_PROFILE_CONTENT;
        out[1] = VERSION_CURRENT;
        out.set(compressed, 2);
        return out;
    }

    return {decode, encode, PROFILE_TYPE};
})();
