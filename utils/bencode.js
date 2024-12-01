// bencode.js
import crypto from 'crypto';


function decodeBencode(bencodedValue) {
    let index = 0;
  
    function decode() {
      if (bencodedValue[index] === 'i') {
        // Decode integer
        index++;
        let end = bencodedValue.indexOf('e', index);
        if (end === -1) {
          throw new Error('Invalid integer value');
        }
        let numberStr = bencodedValue.substring(index, end);
        let number = parseInt(numberStr, 10);
        if (isNaN(number)) {
          throw new Error('Invalid integer value');
        }
        index = end + 1;
        return number;
      } else if (bencodedValue[index] === 'l') {
        // Decode list
        index++;
        let list = [];
        while (bencodedValue[index] !== 'e') {
          list.push(decode());
        }
        index++;
        return list;
      } else if (bencodedValue[index] === 'd') {
        // Decode dictionary
        index++;
        let dict = {};
        while (bencodedValue[index] !== 'e') {
          let key = decode();
          if (typeof key !== 'string') {
            throw new Error('Dictionary keys must be strings');
          }
          let value = decode();
          dict[key] = value;
        }
        index++;
        return dict;
      } else if (/\d/.test(bencodedValue[index])) {
        // Decode string
        let lengthStr = '';
        while (/\d/.test(bencodedValue[index])) {
          lengthStr += bencodedValue[index];
          index++;
        }
        if (bencodedValue[index] !== ':') {
          throw new Error('Invalid string value');
        }
        index++;
        let length = parseInt(lengthStr, 10);
        let str = bencodedValue.substring(index, index + length);
        if (str.length !== length) {
          throw new Error('Invalid string length');
        }
        index += length;
        return str;
      } else {
        throw new Error('Invalid bencoded value');
      }
    }
  
    return decode();
}

export default  decodeBencode ;