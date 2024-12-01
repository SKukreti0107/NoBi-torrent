// main.js
import decodeBencode from './utils/bencode.js';

import { parseTorrentFile, calculateInfoHash, extractPieceInfo } from './utils/torrent.js';

import { getPeers, urlEncodeBinary} from './utils/network.js';

import {downloadFile, downloadPiece} from './utils/download.js';

import process from 'process';
import crypto from 'crypto';
import http from 'http';
import https from 'https';
import url from 'url';

function main() {
    const command = process.argv[2];
  
    if (command === "decode") {
      const bencodedValue = process.argv[3];
      try {
        const decoded = decodeBencode(bencodedValue);
        console.log(JSON.stringify(decoded)); 
      } catch (error) {
        console.error(`Error: ${error.message}`);
      }
    } else if (command === "info") {
      const filename = process.argv[3];
      try {
        const data = parseTorrentFile(filename);
        const announce = data['announce'];
        const info = data['info'];
        const length = info['length'];
        const infoHash = calculateInfoHash(filename);
        const { pieceLength, pieceHashes } = extractPieceInfo(info);
        console.log(`Tracker URL: ${announce}`);
        console.log(`Length: ${length}`);
        console.log(`Info Hash: ${infoHash.toString('hex')}`);
        console.log(`Piece Length: ${pieceLength}`);
        console.log(`Piece Hashes: ${pieceHashes.join(', ')}`);
      } catch (error) {
        console.error(`Error: ${error.message}`);
      }
    }
    else if (command === "peers") {
      const filename = process.argv[3];
      try {
        const data = parseTorrentFile(filename);
        const announce = data['announce'];
        const info = data['info'];
        const length = info['length'];
        const infoHash = calculateInfoHash(filename);
        getPeers(announce, infoHash, length);
      } catch (error) {
        console.error(`Error: ${error.message}`);
      }
    }
    else if (command === "handshake") {
      const filename = process.argv[3];
      const peerAddress = process.argv[4];
      try {
        const data = parseTorrentFile(filename);
        const infoHash = calculateInfoHash(filename);
        handshakeWithPeer(peerAddress, infoHash);
      } catch (error) {
        console.error(`Error: ${error.message}`);
      }
    }
    else if (command === "download_piece") {
      const outputIndex = process.argv.indexOf('-o');
      if (outputIndex === -1 || outputIndex + 1 >= process.argv.length) {
        console.error('Output file not specified.');
        process.exit(1);
      }
      const outputPath = process.argv[outputIndex + 1];
  
      // Determine indices for filename and pieceIndex
      const argsAfterOutput = process.argv.slice(outputIndex + 2);
      if (argsAfterOutput.length < 2) {
        console.error('Torrent file and piece index must be specified.');
        process.exit(1);
      }
      const filename = argsAfterOutput[0];
      const pieceIndex = parseInt(argsAfterOutput[1], 10);
  
      if (isNaN(pieceIndex)) {
        console.error('Invalid piece index.');
        process.exit(1);
      }
  
      try {
        const data = parseTorrentFile(filename);
        const announce = data['announce'];
        const info = data['info'];
        const length = info['length'];
        const infoHash = calculateInfoHash(filename);
        const { pieceLength, pieceHashes } = extractPieceInfo(info);
  
        // Check if pieceIndex is within bounds
        if (pieceIndex < 0 || pieceIndex >= pieceHashes.length) {
          console.error('Invalid piece index.');
          process.exit(1);
        }
  
        const peers = [];
  
        // Get peers
        const getPeersPromise = new Promise((resolve, reject) => {
          const infoHashBuffer = Buffer.from(infoHash, 'hex');
          const infoHashEncoded = urlEncodeBinary(infoHashBuffer);
  
          const peerIdBuffer = Buffer.alloc(20);
          peerIdBuffer.write('-PC0001-');
          crypto.randomBytes(12).copy(peerIdBuffer, 8);
          const peerId = urlEncodeBinary(peerIdBuffer);
  
          const params = {
            info_hash: infoHashEncoded,
            peer_id: peerId,
            port: 6881,
            uploaded: 0,
            downloaded: 0,
            left: length,
            compact: 1
          };
  
          const parsedUrl = url.parse(announce);
          const queryString = Object.keys(params)
            .map(key => `${key}=${params[key]}`)
            .join('&');
  
          const requestOptions = {
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: `${parsedUrl.pathname}?${queryString}`,
            method: 'GET'
          };
  
          const protocolModule = parsedUrl.protocol === 'https:' ? https : http;
  
          const req = protocolModule.request(requestOptions, (res) => {
            let responseData = '';
            res.setEncoding('binary');
            res.on('data', (chunk) => {
              responseData += chunk;
            });
            res.on('end', () => {
              try {
                const response = decodeBencode(responseData);
                const peersBinary = response['peers'];
                const peersBuffer = Buffer.from(peersBinary, 'binary');
                for (let i = 0; i < peersBuffer.length; i += 6) {
                  const ip = `${peersBuffer[i]}.${peersBuffer[i+1]}.${peersBuffer[i+2]}.${peersBuffer[i+3]}`;
                  const port = peersBuffer.readUInt16BE(i + 4);
                  peers.push(`${ip}:${port}`);
                }
                resolve();
              } catch (error) {
                reject(`Error decoding tracker response: ${error.message}`);
              }
            });
          });
  
          req.on('error', (e) => {
            reject(`Error with request: ${e.message}`);
          });
  
          req.end();
        });
  
        getPeersPromise.then(() => {
          if (peers.length === 0) {
            console.error('No peers found.');
            process.exit(1);
          }
          const pieceHash = pieceHashes[pieceIndex];
          const adjustedPieceLength = (pieceIndex === pieceHashes.length - 1) ? (length - pieceLength * (pieceHashes.length - 1)) : pieceLength;
          // Use the first peer
          downloadPiece(peers[0], infoHash, pieceIndex, adjustedPieceLength, pieceHash, outputPath);
        }).catch((error) => {
          console.error(error);
          process.exit(1);
        });
  
      } catch (error) {
        console.error(`Error: ${error.message}`);
      }
    } else if (command === "download") {
      const outputIndex = process.argv.indexOf('-o');
      if (outputIndex === -1 || outputIndex + 1 >= process.argv.length) {
        console.error('Output file not specified.');
        process.exit(1);
      }
      const outputPath = process.argv[outputIndex + 1];
      const filename = process.argv[outputIndex + 2];
  
      if (!filename) {
        console.error('Torrent file not specified.');
        process.exit(1);
      }
  
      try {
        const data = parseTorrentFile(filename);
        const announce = data['announce'];
        const info = data['info'];
        const length = info['length'];
        const infoHash = calculateInfoHash(filename);
        const { pieceLength, pieceHashes } = extractPieceInfo(info);
  
        const peers = [];
        const getPeersPromise = new Promise((resolve, reject) => {
          const infoHashBuffer = Buffer.from(infoHash, 'hex');
          const infoHashEncoded = urlEncodeBinary(infoHashBuffer);
  
          const peerIdBuffer = Buffer.alloc(20);
          peerIdBuffer.write('-PC0001-');
          crypto.randomBytes(12).copy(peerIdBuffer, 8);
          const peerId = urlEncodeBinary(peerIdBuffer);
  
          const params = {
            info_hash: infoHashEncoded,
            peer_id: peerId,
            port: 6881,
            uploaded: 0,
            downloaded: 0,
            left: length,
            compact: 1
          };
  
          const parsedUrl = url.parse(announce);
          const queryString = Object.keys(params)
            .map(key => `${key}=${params[key]}`)
            .join('&');
  
          const requestOptions = {
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: `${parsedUrl.pathname}?${queryString}`,
            method: 'GET'
          };
  
          const protocolModule = parsedUrl.protocol === 'https:' ? https : http;
  
          const req = protocolModule.request(requestOptions, (res) => {
            let responseData = '';
            res.setEncoding('binary');
            res.on('data', (chunk) => {
              responseData += chunk;
            });
            res.on('end', () => {
              try {
                const response = decodeBencode(responseData);
                const peersBinary = response['peers'];
                const peersBuffer = Buffer.from(peersBinary, 'binary');
                for (let i = 0; i < peersBuffer.length; i += 6) {
                  const ip = `${peersBuffer[i]}.${peersBuffer[i+1]}.${peersBuffer[i+2]}.${peersBuffer[i+3]}`;
                  const port = peersBuffer.readUInt16BE(i + 4);
                  peers.push(`${ip}:${port}`);
                }
                resolve();
              } catch (error) {
                reject(`Error decoding tracker response: ${error.message}`);
              }
            });
          });
  
          req.on('error', (e) => {
            reject(`Error with request: ${e.message}`);
          });
  
          req.end();
        });
  
        getPeersPromise.then(() => {
          if (peers.length === 0) {
            console.error('No peers found.');
            process.exit(1);
          }
          downloadFile(peers, infoHash, pieceLength, pieceHashes, length, outputPath);
        }).catch((error) => {
          console.error(error);
          process.exit(1);
        });
  
      } catch (error) {
        console.error(`Error: ${error.message}`);
      }
    } else {
      console.error(`Unknown command ${command}`);
      process.exit(1);
    }
}
  
main();
  