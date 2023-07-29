/**
* created by rush, based on htu21d-node.js
*/

/**
* Copyright Bradley Smith - bradley.1.smith@gmail.com
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
* http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
**/

module.exports = function(RED) {
  "use strict";
  // NPM Imports
  const i2c = require('i2c-bus');
  let BigNumber = require('bignumber.js');
  // Local Imports
  const Util = require('./util.js');
  const CRC = require('./crc8.js');

  const SEN5xAddress = 0x69;

  const commandStartMeasurement_MSB = 0x00; //
  const commandStartMeasurement_LSB = 0x21; //
  const commandStartMeasurementRHTGas_MSB = 0x00; //
  const commandStartMeasurementRHTGas_LSB = 0x37; //
  const commandMeasurementOutput_MSB = 0x03; //
  const commandMeasurementOutput_LSB = 0xC4; //
  const commandStartMeasurement_CRC = 0xAC;
  const commandStopMeasurement_MSB = 0x01; //
  const commandStopMeasurement_LSB = 0x04; //
  const commandReadDataReady_MSB = 0x02; //
  const commandReadDataReady_LSB = 0x02; //
  const commandReadMeasuredValues_MSB = 0x03; //
  const commandReadMeasuredValues_LSB = 0xC4; //
  const commandReadFirmware_MSB = 0xD1; //
  const commandReadFirmware_LSB = 0x00; //
  const commandFanCleaning_MSB = 0x56; //
  const commandFanCleaning_LSB = 0x07; //
  const commandReadDeviceStatus_MSB = 0xD2; //
  const commandReadDeviceStatus_LSB = 0x06; //

  let i2cBus = undefined;
  //let WriteBuffer = Buffer.alloc(2);
  let ReadBuffer = Buffer.alloc(3);
  let firmware = new String;

  // The main node definition - most things happen in here
  function sen5x(config) {

    // Create a RED node
    RED.nodes.createNode(this, config);

    // copy "this" object in case we need it in context of callbacks of other functions.
    let node = this;

    // 1. Process Config
    node.debugMode = (config && config.debugMode);

    function debug(msg) {
      if (node.debugMode) {
        node.log(msg);
      }
    }

    debug(JSON.stringify(config));

    node.address = SEN5xAddress;
    node.name = `SEN5x @ 0x${node.address.toString(16)}`;

    // 2. Initialize Sensor
    node.ready = false;
    node.status({ fill: "green", shape: "ring", text: "SEN5x sensor initializing" });

    if (i2cBus == undefined) {
      i2cBus = i2c.open(1, err => {
        if (err) {
          node.error(`problem initializing i2c bus.`);
          node.status({ fill: "red", shape: "ring", text: `problem initializing i2c bus.` });
        }
      });
      debug("opened i2cBus -> " + i2cBus);
    }

    //i2cBus.scan((err, devices) => {
    //  if (err) {
    //    node.error(`problem scanning i2c bus.`);
    //    node.status({ fill: "red", shape: "ring", text: `problem initializing i2c bus.` });
    //  }
    //  debug("devices -> " + devices);
    //});

    //i2cBus.deviceId(node.address, (err, id) => {
    //  if (err) {
    //    let errMsg = `send read command error:  ${err}`;
    //    node.error(errMsg);
    //  }
    //  debug(JSON.stringify(id));
    //});

    node.on('sensor_ready', () => {
      node.status({ fill: "green", shape: "dot", text: `${node.name} ready.` });
    });
    node.ready = true;
    readFirmware();
    node.emit('sensor_ready');

    // respond to inputs....
    this.on('input', (msg) => {
      let command = msg.payload; // One of:  measure, set_config, get_config, ... TODO - add other input types support
      if (command) {
        if ("measure" === command) {

          let now = Date.now();
          measure(node).then((resolve) => {
            node.send([
              { topic: 'SEN5x', payload: resolve }
            ]);
          }, (reject) => {
            msg.payload = `${reject}`;
            node.send(msg);
          });

        } else if ("startMeasurement" === command) {
          startMeasurement(node);
          debug(`startMeasurement`);
        }
        else if ("stopMeasurement" === command) {
          stopMeasurement(node);
          debug(`stopMeasurement`);
        }
        else if ("fanCleaning" === command) {
          fanCleaning(node);
          debug(`Fan Cleaning`);
        }
        else if ("readFirmware" === command) {
          readFirmware(node);
          debug(`readFirmware`);
        }
      }
    });

    this.on("close", () => {
      debug("close");
      // Called when the node is shutdown - eg on redeploy.
      // Allows ports to be closed, connections dropped etc.
      // eg: node.client.disconnect();
    });

    async function startMeasurement() {
      const WriteBuffer = Buffer.from([commandStartMeasurement_MSB, commandStartMeasurement_LSB]);
      i2cBus.i2cWrite(node.address, WriteBuffer.length, WriteBuffer, (err) => {
        if (err) {
          let errMsg = `send read command error:  ${err}`;
          node.error(errMsg);
        }
        node.status({ fill: "green", shape: "ring", text: "SEN5x start measurement" });
        console.log(WriteBuffer);
      });
    }

    async function stopMeasurement() {
      const WriteBuffer = Buffer.from([commandStopMeasurement_MSB, commandStopMeasurement_LSB]);
      i2cBus.i2cWrite(node.address, WriteBuffer.length, WriteBuffer, (err) => {
        if (err) {
          let errMsg = `send read command error:  ${err}`;
          node.error(errMsg);
        }
        node.status({ fill: "green", shape: "ring", text: "SEN5x stop measurement" });
      });
    }

    async function fanCleaning() {
      const WriteBuffer = Buffer.from([commandFanCleaning_MSB, commandFanCleaning_LSB]);
      i2cBus.i2cWrite(node.address, WriteBuffer.length, WriteBuffer, (err) => {
        if (err) {
          let errMsg = `send read command error:  ${err}`;
          node.error(errMsg);
        }
        node.status({ fill: "green", shape: "ring", text: "SEN5x fan cleaning" });
      });
    }

    async function getDataReady() {
      i2cBus.writeByte(node.address, commandGetDataReady_MSB, commandGetDataReady_LSB);
      i2cBus.i2cRead(node.address, ReadBuffer.length, ReadBuffer, (err, bytesRead, buffer) => {
        if (err) {
          return 0;
        } else {
          return 1;
        }
        node.status({ fill: "green", shape: "ring", text: "SEN5x data ready" });
      });
    }

    async function readFirmware() {
      i2cBus.writeByteSync(node.address, commandReadFirmware_MSB, commandReadFirmware_LSB);
      i2cBus.i2cRead(node.address, ReadBuffer.length, ReadBuffer, (err, bytesRead, buffer) => {
        if (CRC.calcCRC8(ReadBuffer.subarray(0, 2)) == ReadBuffer.readUInt8(2)) {
          firmware = ReadBuffer.readUInt8(0).toString(8) + "." + ReadBuffer.readUInt8(1).toString(8);
        }
        node.emit('sensor_ready');
      });
    }

    async function measure() {
      return new Promise((resolve, reject) => {
        const RawData = Buffer.alloc(24);
        let BufferPos = 0;

        // Start readout
        if (getDataReady) {
          i2cBus.writeByteSync(node.address, commandReadMeasuredValues_MSB, commandReadMeasuredValues_LSB);

          i2cBus.i2cRead(node.address, RawData.length, RawData, (err, bytesRead, buffer) => {
            if (err) {
              let errMsg = `read data error:  ${err}`;
              node.error(errMsg);
              reject(errMsg);
            } else {

              //Mass Concentration PM1.0 [μg/m3]
              if (CRC.calcCRC8(RawData.subarray(BufferPos, BufferPos + 2)) == RawData.readUInt8(BufferPos + 2)) {
                debug('Mass PM1.0 CRC ok');
                var MassPM1 = (RawData.readUInt16BE(BufferPos) / 10);
              }
              else {
                let errMsg = `Mass PM1.0 CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              //Mass Concentration PM2.5 [μg/m3]
              BufferPos = 3;
              if (CRC.calcCRC8(RawData.subarray(BufferPos, BufferPos + 2)) == RawData.readUInt8(BufferPos + 2)) {
                debug('Mass PM2.5 CRC ok');
                var MassPM2 = (RawData.readUInt16BE(BufferPos) / 10);
              }
              else {
                let errMsg = `Mass PM2.5 CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              //Mass Concentration PM4.0 [μg/m3]
              BufferPos = 6;
              if (CRC.calcCRC8(RawData.subarray(BufferPos, BufferPos + 2)) == RawData.readUInt8(BufferPos + 2)) {
                debug('Mass PM4.0 CRC ok');
                var MassPM4 = (RawData.readUInt16BE(BufferPos) / 10);
              }
              else {
                let errMsg = `Mass PM4.0 CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              //Mass Concentration PM10 [μg/m3]
              BufferPos = 9;
              if (CRC.calcCRC8(RawData.subarray(BufferPos, BufferPos + 2)) == RawData.readUInt8(BufferPos + 2)) {
                debug('Mass PM10 CRC ok');
                var MassPM10 = (RawData.readUInt16BE(BufferPos) / 10);
              }
              else {
                let errMsg = `Mass PM10 CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              //Compensated Humidity [%]
              BufferPos = 12;
              if (CRC.calcCRC8(RawData.subarray(BufferPos, BufferPos + 2)) == RawData.readUInt8(BufferPos + 2)) {
                debug('Humidity CRC ok');
                var Humidity = (RawData.readUInt16BE(BufferPos) / 100);
              }
              else {
                let errMsg = `Humidity CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              //Compensated Temperature [°C]
              BufferPos = 15;
              //debug("measure Temp -> " + (RawData.readUInt16BE(BufferPos) / 200));
              if (CRC.calcCRC8(RawData.subarray(BufferPos, BufferPos + 2)) == RawData.readUInt8(BufferPos + 2)) {
                debug('Temperature CRC ok');
                var Temperature = RawData.readUInt16BE(BufferPos) / 200;
              }
              else {
                let errMsg = `Temperature CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              //VOC Index []
              BufferPos = 18;
              if (CRC.calcCRC8(RawData.subarray(BufferPos, BufferPos + 2)) == RawData.readUInt8(BufferPos + 2)) {
                debug('VOC Index CRC ok');
                var VOCIndex = RawData.readUInt16BE(BufferPos) / 10;
              }
              else {
                let errMsg = `VOC Index CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              //NOx Index []
              BufferPos = 21;
              if (CRC.calcCRC8(RawData.subarray(BufferPos, BufferPos + 2)) == RawData.readUInt8(BufferPos + 2)) {
                debug('NOx Index CRC ok');
                var NOxIndex = RawData.readUInt16BE(BufferPos) / 10;
              }
              else {
                let errMsg = `NOx Index CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              debug(`Mass Concentration PM1.0:  ${MassPM1} [μg/m3]`);
              debug(`Mass Concentration PM2.5:  ${MassPM2} [μg/m3]`);
              debug(`Mass Concentration PM4.0:  ${MassPM4} [μg/m3]`);
              debug(`Mass Concentration PM10:  ${MassPM10} [μg/m3]`);
              debug(`Compensated Humidity:  ${Humidity} [%]`);
              debug(`Compensated Temperature:  ${Temperature} [°C]`);
              debug(`VOC Index:  ${VOCIndex} []`);
              debug(`NOx Index:  ${NOxIndex} []`);

              let rsv = {
                'name': node.name,
                'timestamp': Util.getTimestamp(),
                'MassPM1.0': MassPM1,
                'MassPM2.5': MassPM2,
                'MassPM4.0': MassPM4,
                'MassPM10': MassPM10,
                'Compensated Humidity': Humidity,
                'Compensated Temperature': Temperature,
                'VOC Index': VOCIndex,
                'NOx Index': NOxIndex
              };
              resolve(rsv);
            }
          });
        } //getDataReady
      });
    }
  }


  // Register the node by name. This must be called before overriding any of the
  // Node functions.
  RED.nodes.registerType("sen5x", sen5x);

}
