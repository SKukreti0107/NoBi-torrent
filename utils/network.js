// network.js
import http from 'http';
import https from 'https';
import decodeBencode  from './bencode.js';
import crypto from 'crypto';   
import url from 'url'; 

function urlEncodeBinary(buffer) {
    let result = '';
    for (const byte of buffer) {
      let hex = byte.toString(16);
      if (hex.length === 1) hex = '0' + hex;
      result += '%' + hex;
    }
    return result;
}

function getPeers(announceUrl, infoHashHex, length) {
    const infoHashBuffer = Buffer.from(infoHashHex, 'hex');
    const infoHash = urlEncodeBinary(infoHashBuffer);
  
    const peerIdBuffer = Buffer.alloc(20);
    peerIdBuffer.write('-PC0001-');
    crypto.randomBytes(12).copy(peerIdBuffer, 8);
    const peerId = urlEncodeBinary(peerIdBuffer);
  
    const params = {
      info_hash: infoHash,
      peer_id: peerId,
      port: 6881,
      uploaded: 0,
      downloaded: 0,
      left: length,
      compact: 1
    };
  
    const parsedUrl = url.parse(announceUrl);
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
      let data = '';
      res.setEncoding('binary');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const response = decodeBencode(data);
          const peersBinary = response['peers'];
          const peersBuffer = Buffer.from(peersBinary, 'binary');
          for (let i = 0; i < peersBuffer.length; i += 6) {
            const ip = `${peersBuffer[i]}.${peersBuffer[i+1]}.${peersBuffer[i+2]}.${peersBuffer[i+3]}`;
            const port = peersBuffer.readUInt16BE(i + 4);
            console.log(`${ip}:${port}`);
          }
        } catch (error) {
          console.error(`Error decoding response: ${error.message}`);
        }
      });
    });
  
    req.on('error', (e) => {
      console.error(`Error with request: ${e.message}`);
    });
  
    req.end();
}


export { getPeers, urlEncodeBinary };