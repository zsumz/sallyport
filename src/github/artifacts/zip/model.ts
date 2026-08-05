export const CENTRAL_SIGNATURE = 0x02014b50;
export const CENTRAL_HEADER_SIZE = 46;
export const MAX_COMMENT = 0xffff;
export const ZIP64_MARKER = 0xffffffff;

export interface EntryLocation {
    localOffset: number;
    method: number;
    crc: number;
    compressedSize: number;
    uncompressedSize: number;
    name: string;
}
