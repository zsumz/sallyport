const ASCII_SPACE = 0x20;
const ASCII_NEWLINE = 0x0a;

export function parsePaxRecords(data: Buffer): Array<[string, string]> {
    const records: Array<[string, string]> = [];
    let offset = 0;
    while (offset < data.length) {
        const space = data.indexOf(ASCII_SPACE, offset);
        if (space === -1) {
            throw new Error('Tarball contains a malformed pax extended header.');
        }
        const digits = data.subarray(offset, space).toString('latin1');
        if (!/^[0-9]+$/.test(digits)) {
            throw new Error('Tarball contains a pax record with an invalid length.');
        }
        const length = Number(digits);
        if (length <= space - offset + 1 || offset + length > data.length) {
            throw new Error('Tarball contains a pax record with an invalid length.');
        }
        if (data.readUInt8(offset + length - 1) !== ASCII_NEWLINE) {
            throw new Error('Tarball contains a pax record without a terminating newline.');
        }
        const text = data.subarray(space + 1, offset + length - 1).toString('utf8');
        const separator = text.indexOf('=');
        if (separator <= 0) {
            throw new Error('Tarball contains a pax record without a keyword.');
        }
        records.push([text.slice(0, separator), text.slice(separator + 1)]);
        offset += length;
    }
    return records;
}
