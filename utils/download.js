// downloader.js
import net from 'net';
import fs from 'fs';
import process from 'process';
import crypto from 'crypto';

function downloadFile(peers, infoHashHex, pieceLength, pieceHashes, totalLength, outputPath) {
  // Keep track of the current peer index
  let peerIndex = 0;
  let client = null;
  let pieceIndex = 0;
  const numPieces = pieceHashes.length;
  const fileBuffer = Buffer.alloc(totalLength);

  function connectToPeer() {
    if (peerIndex >= peers.length) {
      console.error('All peers failed or are unresponsive.');
      process.exit(1);
    }

    const peerAddress = peers[peerIndex];
    console.log(`Connecting to peer: ${peerAddress}`);
    const [ip, port] = peerAddress.split(':');
    const infoHashBuffer = Buffer.from(infoHashHex, 'hex');

    // Generate a random peer ID
    const peerIdBuffer = Buffer.alloc(20);
    crypto.randomBytes(20).copy(peerIdBuffer);

    // Handshake message components
    const protocolStr = 'BitTorrent protocol';
    const protocolLen = Buffer.from([protocolStr.length]);
    const reserved = Buffer.alloc(8, 0);
    const handshake = Buffer.concat([
      protocolLen,
      Buffer.from(protocolStr),
      reserved,
      infoHashBuffer,
      peerIdBuffer
    ]);

    client = new net.Socket();

    // Set a timeout for the socket
    client.setTimeout(10000); // 10 seconds

    client.connect(parseInt(port), ip, () => {
      client.write(handshake);
    });

    let state = 'handshake';
    let buffer = Buffer.alloc(0);
    let bitfieldReceived = false;
    let interestedSent = false;
    let unchoked = false;
    let downloadingPiece = false;
    let pieceBuffer, receivedBlocks, totalBlocks, requestedBlocks, adjustedPieceLength;

    client.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);

      while (true) {
        if (state === 'handshake') {
          if (buffer.length < 68) {
            return;
          }
          buffer = buffer.slice(68);
          state = 'messages';
        } else if (state === 'messages') {
          if (buffer.length < 4) {
            return;
          }
          const length = buffer.readUInt32BE(0);
          if (buffer.length < 4 + length) {
            return;
          }
          if (length === 0) {
            buffer = buffer.slice(4);
            continue;
          }
          const id = buffer[4];

          if (id === 5 && !bitfieldReceived) {
            bitfieldReceived = true;
            if (!interestedSent) {
              const interested = Buffer.from([0, 0, 0, 1, 2]);
              client.write(interested);
              interestedSent = true;
            }
          } else if (id === 1 && !unchoked) {
            unchoked = true;
            requestPiece();
          } else if (id === 7 && downloadingPiece) {
            const payload = buffer.slice(5, 4 + length);
            const index = payload.readUInt32BE(0);
            const begin = payload.readUInt32BE(4);
            const block = payload.slice(8);
            block.copy(pieceBuffer, begin);
            receivedBlocks++;
            requestNextBlock();
            if (receivedBlocks === totalBlocks) {
              const sha1 = crypto.createHash('sha1');
              sha1.update(pieceBuffer);
              const pieceHashComputed = sha1.digest('hex');
              const expectedHash = pieceHashes[pieceIndex];
              if (pieceHashComputed === expectedHash) {
                pieceBuffer.copy(fileBuffer, pieceIndex * pieceLength);
                pieceIndex++;
                if (pieceIndex < numPieces) {
                  requestPiece();
                } else {
                  fs.writeFileSync(outputPath, fileBuffer);
                  console.log('File downloaded and verified successfully.');
                  client.destroy();
                  process.exit(0);
                }
              } else {
                console.error(`Piece ${pieceIndex} hash mismatch.`);
                client.destroy();
                tryNextPeer();
                return;
              }
            }
          } else {
            // Handle other message IDs if necessary
          }
          buffer = buffer.slice(4 + length);
        }
      }
    });

    function requestPiece() {
      adjustedPieceLength = (pieceIndex === pieceHashes.length - 1) ? (totalLength - pieceLength * (pieceHashes.length - 1)) : pieceLength;
      pieceBuffer = Buffer.alloc(adjustedPieceLength);
      receivedBlocks = 0;
      requestedBlocks = 0;
      totalBlocks = Math.ceil(adjustedPieceLength / (16 * 1024));
      downloadingPiece = true;
      requestNextBlock();
    }

    function requestNextBlock() {
      while (requestedBlocks < totalBlocks && requestedBlocks - receivedBlocks < 5) {
        const blockSize = 16 * 1024;
        const begin = requestedBlocks * blockSize;
        let length = blockSize;
        if (begin + length > adjustedPieceLength) {
          length = adjustedPieceLength - begin;
        }
        const payload = Buffer.alloc(12);
        payload.writeUInt32BE(pieceIndex, 0);
        payload.writeUInt32BE(begin, 4);
        payload.writeUInt32BE(length, 8);
        const message = Buffer.alloc(17);
        message.writeUInt32BE(13, 0);
        message.writeUInt8(6, 4);
        payload.copy(message, 5);
        client.write(message);
        requestedBlocks++;
      }
    }

    client.on('timeout', () => {
      console.error('Connection timed out.');
      client.destroy();
      tryNextPeer();
    });

    client.on('error', (err) => {
      console.error(`Connection error: ${err.message}`);
      client.destroy();
      tryNextPeer();
    });

    client.on('close', () => {
      // If the connection closes unexpectedly, try the next peer
      if (pieceIndex < numPieces) {
        console.error('Connection closed by peer.');
        tryNextPeer();
      }
    });
  }

  function tryNextPeer() {
    peerIndex++;
    connectToPeer();
  }

  // Start by connecting to the first peer
  connectToPeer();
}

function downloadPiece(peers, infoHashHex, pieceIndex, pieceHash, pieceLength, outputPath) {
  let peerIndex = 0;
  let client = null;
  const infoHashBuffer = Buffer.from(infoHashHex, 'hex');

  function connectToPeer() {
    if (peerIndex >= peers.length) {
      console.error('All peers failed or are unresponsive.');
      process.exit(1);
    }

    const peerAddress = peers[peerIndex];
    console.log(`Connecting to peer: ${peerAddress}`);
    const [ip, port] = peerAddress.split(':');

    const peerIdBuffer = Buffer.alloc(20);
    crypto.randomBytes(20).copy(peerIdBuffer);

    const protocolStr = 'BitTorrent protocol';
    const protocolLen = Buffer.from([protocolStr.length]);
    const reserved = Buffer.alloc(8, 0);
    const handshake = Buffer.concat([
      protocolLen,
      Buffer.from(protocolStr),
      reserved,
      infoHashBuffer,
      peerIdBuffer,
    ]);

    client = new net.Socket();
    client.setTimeout(10000);

    client.connect(parseInt(port), ip, () => {
      client.write(handshake);
    });

    let state = 'handshake';
    let buffer = Buffer.alloc(0);
    let bitfieldReceived = false;
    let interestedSent = false;
    let unchoked = false;
    let downloadingPiece = false;
    let pieceBuffer = Buffer.alloc(pieceLength);
    let receivedBlocks = 0;
    let requestedBlocks = 0;
    const totalBlocks = Math.ceil(pieceLength / (16 * 1024));

    client.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);

      while (true) {
        if (state === 'handshake') {
          if (buffer.length < 68) {
            return;
          }
          buffer = buffer.slice(68);
          state = 'messages';
        } else if (state === 'messages') {
          if (buffer.length < 4) {
            return;
          }
          const length = buffer.readUInt32BE(0);
          if (buffer.length < 4 + length) {
            return;
          }
          if (length === 0) {
            buffer = buffer.slice(4);
            continue;
          }
          const id = buffer[4];

          if (id === 5 && !bitfieldReceived) {
            bitfieldReceived = true;
            if (!interestedSent) {
              const interested = Buffer.from([0, 0, 0, 1, 2]);
              client.write(interested);
              interestedSent = true;
            }
          } else if (id === 1 && !unchoked) {
            unchoked = true;
            requestBlock();
          } else if (id === 7 && downloadingPiece) {
            const payload = buffer.slice(5, 4 + length);
            const index = payload.readUInt32BE(0);
            const begin = payload.readUInt32BE(4);
            const block = payload.slice(8);
            block.copy(pieceBuffer, begin);
            receivedBlocks++;
            requestBlock();
            if (receivedBlocks === totalBlocks) {
              const sha1 = crypto.createHash('sha1');
              sha1.update(pieceBuffer);
              const pieceHashComputed = sha1.digest('hex');
              if (pieceHashComputed === pieceHash) {
                fs.writeFileSync(outputPath, pieceBuffer);
                console.log('Piece downloaded and verified successfully.');
                client.destroy();
                process.exit(0);
              } else {
                console.error(`Piece ${pieceIndex} hash mismatch.`);
                client.destroy();
                tryNextPeer();
                return;
              }
            }
          }
          buffer = buffer.slice(4 + length);
        }
      }
    });

    function requestBlock() {
      while (requestedBlocks < totalBlocks && requestedBlocks - receivedBlocks < 5) {
        const blockSize = 16 * 1024;
        const begin = requestedBlocks * blockSize;
        let length = blockSize;
        if (begin + length > pieceLength) {
          length = pieceLength - begin;
        }
        const payload = Buffer.alloc(12);
        payload.writeUInt32BE(pieceIndex, 0);
        payload.writeUInt32BE(begin, 4);
        payload.writeUInt32BE(length, 8);
        const message = Buffer.alloc(17);
        message.writeUInt32BE(13, 0);
        message.writeUInt8(6, 4);
        payload.copy(message, 5);
        client.write(message);
        requestedBlocks++;
      }
    }

    client.on('timeout', () => {
      console.error('Connection timed out.');
      client.destroy();
      tryNextPeer();
    });

    client.on('error', (err) => {
      console.error(`Connection error: ${err.message}`);
      client.destroy();
      tryNextPeer();
    });

    client.on('close', () => {
      console.error('Connection closed by peer.');
      tryNextPeer();
    });
  }

  function tryNextPeer() {
    peerIndex++;
    connectToPeer();
  }

  connectToPeer();
}

export  { downloadFile, downloadPiece }; 