// torrent.js

import decodeBencode from './bencode.js';
import crypto from 'crypto';
import fs from 'fs';

//Reads a torrent file from the specified filename and decodes its Bencode content.

function parseTorrentFile(filename) {
    const buffer = fs.readFileSync(filename);
    const bencodedString = buffer.toString('binary');
    const data = decodeBencode(bencodedString);
    return data;
}

//Calculates the SHA-1 hash of the "info" dictionary within the torrent file. This hash is a crucial identifier of the torrent.

function calculateInfoHash(filename) {
    const buffer = fs.readFileSync(filename);
  
    let infoStart = null;
    let infoEnd = null;
  
    // Helper function to decode and track positions
    function decode(index) {
      if (buffer[index] === 0x69) { // 'i'
        let start = index;
        index++;
        let end = buffer.indexOf(0x65, index);
        if (end === -1) {
          throw new Error('Invalid integer value');
        }
        index = end + 1;
        return { index };
      } else if (buffer[index] === 0x6c) { // 'l'
        index++;
        while (buffer[index] !== 0x65) {
          const result = decode(index);
          index = result.index;
        }
        index++;
        return { index };
      } else if (buffer[index] === 0x64) { // 'd'
        index++;
        while (buffer[index] !== 0x65) {
          // Decode key
          const keyStart = index;
          const keyResult = decode(index);
          const key = buffer.slice(keyStart, keyResult.index).toString();
  
          index = keyResult.index;
  
          // Check if key is 'info'
          if (key === '4:info') {
            infoStart = index;
            const valueResult = decode(index);
            index = valueResult.index;
            infoEnd = index;
          } else {
            const valueResult = decode(index);
            index = valueResult.index;
          }
        }
        index++;
        return { index };
      } else if (buffer[index] >= 0x30 && buffer[index] <= 0x39) { // '0'-'9'
        let lengthStr = '';
        while (buffer[index] >= 0x30 && buffer[index] <= 0x39) {
          lengthStr += String.fromCharCode(buffer[index]);
          index++;
        }
        if (buffer[index] !== 0x3a) { // ':'
          throw new Error('Invalid string value');
        }
        index++;
        let length = parseInt(lengthStr, 10);
        index += length;
        return { index };
      } else {
        throw new Error('Invalid bencoded value');
      }
    }
  
    // Start decoding from index 0
    decode(0);
  
    if (infoStart === null || infoEnd === null) {
      throw new Error('Info dictionary not found');
    }
  
    const infoBuffer = buffer.slice(infoStart, infoEnd);
  
    const sha1 = crypto.createHash('sha1');
    sha1.update(infoBuffer);
    const infoHash = sha1.digest('hex');
  
    return infoHash;
}

//Extracts information about the torrent's pieces from the parsed torrent data.

function extractPieceInfo(data) {
    const pieceLength = data['piece length'];
    const pieces = data['pieces'];
    const pieceHashes = [];
  
    // Convert pieces to Buffer
    const piecesBuffer = Buffer.from(pieces, 'binary');
  
    // Extract piece hashes
    for (let i = 0; i < piecesBuffer.length; i += 20) {
      const hash = piecesBuffer.slice(i, i + 20); // Each hash is 20 bytes
      pieceHashes.push(hash.toString('hex')); // Convert to hex
    }
  
    return { pieceLength, pieceHashes };
}

export { parseTorrentFile, calculateInfoHash, extractPieceInfo };