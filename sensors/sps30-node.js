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

module.exports = function (RED) {
  "use strict";
  // NPM Imports
  const i2c = require('i2c-bus');
  let BigNumber = require('bignumber.js');
  // Local Imports
  const Util = require('./util.js');
  const CRC = require('./crc8.js');

  const SPS30Address = 0x69;

  const commandStartMeasurement_MSB = 0x00;
  const commandStartMeasurement_LSB = 0x10;
  const commandMeasurementOutput_MSB = 0x03;
  const commandMeasurementOutput_LSB = 0x00;
  const commandStartMeasurement_CRC = 0xAC;
  const commandStopMeasurement_MSB = 0x01;
  const commandStopMeasurement_LSB = 0x04;
  const commandGetDataReady_MSB = 0x02;
  const commandGetDataReady_LSB = 0x02;
  const commandReadMeasurement_MSB = 0x03;
  const commandReadMeasurement_LSB = 0x00;
  const commandReadFirmware_MSB = 0xD1;
  const commandReadFirmware_LSB = 0x00;
  const commandFanCleaning_MSB = 0x56;
  const commandFanCleaning_LSB = 0x07;

  let i2cBus = undefined;
  let SPSWord = new Uint8Array(2);
  let SPSWordCRC = new Uint8Array(3);
  let firmware = new String;

  // The main node definition - most things happen in here
  function sps30(config) {

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

    node.address = SPS30Address;
    node.name = `SPS30 @ 0x${node.address.toString(16)}, FW ${firmware}`;

    // 2. Initialize Sensor
    node.ready = false;
    node.status({fill: "green", shape: "ring", text: "SPS30 sensor initializing"});

    if (i2cBus == undefined) {
      i2cBus = i2c.openSync(1);
      // if (!i2cBus) {
      //   node.error(`problem initializing i2c bus.`);
      //   node.status({fill: "red", shape: "ring", text: `problem initializing i2c bus.`});
      // }
      debug("opened i2cBus -> " + i2cBus);
    }

    node.on('sensor_ready', () => {
      node.status({fill: "green", shape: "dot", text: `${node.name} ready.`});
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
              {topic: 'SPS30', payload: resolve}
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

    function startMeasurement() {
      let SCDWriteBuffer = new Uint8Array([commandStartMeasurement_MSB, commandStartMeasurement_LSB, commandMeasurementOutput_MSB, commandMeasurementOutput_LSB, commandStartMeasurement_CRC]);
      i2cBus.i2cWrite(node.address, SCDWriteBuffer.length, SCDWriteBuffer, (err) => {
        if (err) {
          let errMsg = `send read command error:  ${err}`;
          node.error(errMsg);
        }
        node.status({fill: "green", shape: "ring", text: "SPS30 start measurement"});
      });
    }

    function stopMeasurement() {
      let SCDWriteBuffer = new Uint8Array([commandStopMeasurement_MSB, commandStopMeasurement_LSB]);
      i2cBus.i2cWrite(node.address, SCDWriteBuffer.length, SCDWriteBuffer, (err) => {
        if (err) {
          let errMsg = `send read command error:  ${err}`;
          node.error(errMsg);
        }
        node.status({fill: "green", shape: "ring", text: "SPS30 stop measurement"});
      });
    }

    function fanCleaning() {
      let SCDWriteBuffer = new Uint8Array([commandFanCleaning_MSB, commandFanCleaning_LSB]);
      i2cBus.i2cWrite(node.address, SCDWriteBuffer.length, SCDWriteBuffer, (err) => {
        if (err) {
          let errMsg = `send read command error:  ${err}`;
          node.error(errMsg);
        }
        node.status({fill: "green", shape: "ring", text: "SPS30 fan cleaning"});
      });
    }

    function getDataReady() {
      i2cBus.writeByte(node.address, commandGetDataReady_MSB, commandGetDataReady_LSB, (err) => {
        if (err) {
          let errMsg = `send read check error:  ${err}`;
          node.error(errMsg);
          reject(errMsg);
        }
        //node.status({fill: "green", shape: "ring", text: "SPS30 write data ready"});
      });

      i2cBus.i2cRead(node.address, SPSWordCRC.length, SPSWordCRC, (err, bytesRead, buffer) => {
        if (err) {
          return 0;
        } else {
          return 1;
        }
        //node.status({fill: "green", shape: "ring", text: "SPS30 read data ready"});
      });
    }

    function readFirmware() {
      i2cBus.writeByte(node.address, commandReadFirmware_MSB, commandReadFirmware_LSB, (err) => {
        if (err) {
          let errMsg = `send read check error:  ${err}`;
          node.error(errMsg);
          reject(errMsg);
        }
      });

      i2cBus.i2cRead(node.address, SPSWordCRC.length, SPSWordCRC, (err, bytesRead, buffer) => {
        if ( (CRC.calcCRC8(SPSWordCRC.slice(0,2)) == SPSWordCRC.slice(2,3)) ) {
          firmware = `${SPSWordCRC.slice(0,1)}.${SPSWordCRC.slice(1,2)}`;
        }
        node.emit('sensor_ready');
      });
    }

    function measure() {
      return new Promise((resolve, reject) => {
        let SPSBuffer = new Uint8Array(60);
        let ResultBuffer = new Uint8Array(4);
        let BufferPos = 0;

        // Start readout
        if (getDataReady) {
          i2cBus.writeByte(node.address, commandReadMeasurement_MSB, commandReadMeasurement_LSB, (err) => {
            if (err) {
              let errMsg = `send read data error:  ${err}`;
              node.error(errMsg);
              reject(errMsg);
            }
            //node.status({fill: "green", shape: "ring", text: "SPS30 send read data cmd"});
          });

          i2cBus.i2cRead(node.address, SPSBuffer.length, SPSBuffer, (err, bytesRead, buffer) => {
            if (err) {
              let errMsg = `read data error:  ${err}`;
              node.error(errMsg);
              reject(errMsg);
            } else {
              // debug(CRC.calcCRC8(SPSWord));
              // debug(SPSBuffer.slice(2,3));

              //Mass Concentration PM1.0 [μg/m3]
              if ( (CRC.calcCRC8(SPSBuffer.slice(BufferPos,BufferPos+2)) == SPSBuffer.slice(BufferPos+2,BufferPos+3)) && (CRC.calcCRC8(SPSBuffer.slice(BufferPos+3,BufferPos+5)) == SPSBuffer.slice(BufferPos+5,BufferPos+6)) ) {
                debug('Mass PM1.0 CRC ok');
                ResultBuffer[0] = SPSBuffer.slice(BufferPos,BufferPos+1);
                ResultBuffer[1] = SPSBuffer.slice(BufferPos+1,BufferPos+2);
                ResultBuffer[2] = SPSBuffer.slice(BufferPos+3,BufferPos+4);
                ResultBuffer[3] = SPSBuffer.slice(BufferPos+4,BufferPos+5);
                var MassPM1 = new DataView(ResultBuffer.buffer).getFloat32(0);
              }
              else {
                let errMsg = `Mass PM1.0 CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              //Mass Concentration PM2.5 [μg/m3]
              BufferPos = 6;
              if ( (CRC.calcCRC8(SPSBuffer.slice(BufferPos,BufferPos+2)) == SPSBuffer.slice(BufferPos+2,BufferPos+3)) && (CRC.calcCRC8(SPSBuffer.slice(BufferPos+3,BufferPos+5)) == SPSBuffer.slice(BufferPos+5,BufferPos+6)) ) {
                debug('Mass PM2.5 CRC ok');
                ResultBuffer[0] = SPSBuffer.slice(BufferPos,BufferPos+1);
                ResultBuffer[1] = SPSBuffer.slice(BufferPos+1,BufferPos+2);
                ResultBuffer[2] = SPSBuffer.slice(BufferPos+3,BufferPos+4);
                ResultBuffer[3] = SPSBuffer.slice(BufferPos+4,BufferPos+5);
                var MassPM2 = new DataView(ResultBuffer.buffer).getFloat32(0);
              }
              else {
                let errMsg = `Mass PM2.5 CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              //Mass Concentration PM4.0 [μg/m3]
              BufferPos = 12;
              if ( (CRC.calcCRC8(SPSBuffer.slice(BufferPos,BufferPos+2)) == SPSBuffer.slice(BufferPos+2,BufferPos+3)) && (CRC.calcCRC8(SPSBuffer.slice(BufferPos+3,BufferPos+5)) == SPSBuffer.slice(BufferPos+5,BufferPos+6)) ) {
                debug('Mass PM4.0 CRC ok');
                ResultBuffer[0] = SPSBuffer.slice(BufferPos,BufferPos+1);
                ResultBuffer[1] = SPSBuffer.slice(BufferPos+1,BufferPos+2);
                ResultBuffer[2] = SPSBuffer.slice(BufferPos+3,BufferPos+4);
                ResultBuffer[3] = SPSBuffer.slice(BufferPos+4,BufferPos+5);
                var MassPM4 = new DataView(ResultBuffer.buffer).getFloat32(0);
              }
              else {
                let errMsg = `Mass PM4.0 CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              //Mass Concentration PM10 [μg/m3]
              BufferPos = 18;
              if ( (CRC.calcCRC8(SPSBuffer.slice(BufferPos,BufferPos+2)) == SPSBuffer.slice(BufferPos+2,BufferPos+3)) && (CRC.calcCRC8(SPSBuffer.slice(BufferPos+3,BufferPos+5)) == SPSBuffer.slice(BufferPos+5,BufferPos+6)) ) {
                debug('Mass PM10 CRC ok');
                ResultBuffer[0] = SPSBuffer.slice(BufferPos,BufferPos+1);
                ResultBuffer[1] = SPSBuffer.slice(BufferPos+1,BufferPos+2);
                ResultBuffer[2] = SPSBuffer.slice(BufferPos+3,BufferPos+4);
                ResultBuffer[3] = SPSBuffer.slice(BufferPos+4,BufferPos+5);
                var MassPM10 = new DataView(ResultBuffer.buffer).getFloat32(0);
              }
              else {
                let errMsg = `Mass PM10 CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              //Number Concentration PM0.5 [#/cm3]
              BufferPos = 24;
              if ( (CRC.calcCRC8(SPSBuffer.slice(BufferPos,BufferPos+2)) == SPSBuffer.slice(BufferPos+2,BufferPos+3)) && (CRC.calcCRC8(SPSBuffer.slice(BufferPos+3,BufferPos+5)) == SPSBuffer.slice(BufferPos+5,BufferPos+6)) ) {
                debug('Number PM0.5 CRC ok');
                ResultBuffer[0] = SPSBuffer.slice(BufferPos,BufferPos+1);
                ResultBuffer[1] = SPSBuffer.slice(BufferPos+1,BufferPos+2);
                ResultBuffer[2] = SPSBuffer.slice(BufferPos+3,BufferPos+4);
                ResultBuffer[3] = SPSBuffer.slice(BufferPos+4,BufferPos+5);
                var NumberPM05 = new DataView(ResultBuffer.buffer).getFloat32(0);
              }
              else {
                let errMsg = `Number PM0.5 CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              //Number Concentration PM1.0 [#/cm3]
              BufferPos = 30;
              if ( (CRC.calcCRC8(SPSBuffer.slice(BufferPos,BufferPos+2)) == SPSBuffer.slice(BufferPos+2,BufferPos+3)) && (CRC.calcCRC8(SPSBuffer.slice(BufferPos+3,BufferPos+5)) == SPSBuffer.slice(BufferPos+5,BufferPos+6)) ) {
                debug('Number PM1.0 CRC ok');
                ResultBuffer[0] = SPSBuffer.slice(BufferPos,BufferPos+1);
                ResultBuffer[1] = SPSBuffer.slice(BufferPos+1,BufferPos+2);
                ResultBuffer[2] = SPSBuffer.slice(BufferPos+3,BufferPos+4);
                ResultBuffer[3] = SPSBuffer.slice(BufferPos+4,BufferPos+5);
                var NumberPM1 = new DataView(ResultBuffer.buffer).getFloat32(0);
              }
              else {
                let errMsg = `Number PM1.0 CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              //Number Concentration PM2.5 [#/cm3]
              BufferPos = 36;
              if ( (CRC.calcCRC8(SPSBuffer.slice(BufferPos,BufferPos+2)) == SPSBuffer.slice(BufferPos+2,BufferPos+3)) && (CRC.calcCRC8(SPSBuffer.slice(BufferPos+3,BufferPos+5)) == SPSBuffer.slice(BufferPos+5,BufferPos+6)) ) {
                debug('Number PM2.5 CRC ok');
                ResultBuffer[0] = SPSBuffer.slice(BufferPos,BufferPos+1);
                ResultBuffer[1] = SPSBuffer.slice(BufferPos+1,BufferPos+2);
                ResultBuffer[2] = SPSBuffer.slice(BufferPos+3,BufferPos+4);
                ResultBuffer[3] = SPSBuffer.slice(BufferPos+4,BufferPos+5);
                var NumberPM2 = new DataView(ResultBuffer.buffer).getFloat32(0);
              }
              else {
                let errMsg = `Number PM2.5 CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              //Number Concentration PM4.0 [#/cm3]
              BufferPos = 42;
              if ( (CRC.calcCRC8(SPSBuffer.slice(BufferPos,BufferPos+2)) == SPSBuffer.slice(BufferPos+2,BufferPos+3)) && (CRC.calcCRC8(SPSBuffer.slice(BufferPos+3,BufferPos+5)) == SPSBuffer.slice(BufferPos+5,BufferPos+6)) ) {
                debug('Number PM4.0 CRC ok');
                ResultBuffer[0] = SPSBuffer.slice(BufferPos,BufferPos+1);
                ResultBuffer[1] = SPSBuffer.slice(BufferPos+1,BufferPos+2);
                ResultBuffer[2] = SPSBuffer.slice(BufferPos+3,BufferPos+4);
                ResultBuffer[3] = SPSBuffer.slice(BufferPos+4,BufferPos+5);
                var NumberPM4 = new DataView(ResultBuffer.buffer).getFloat32(0);
              }
              else {
                let errMsg = `Number PM4.0 CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              //Number Concentration PM10 [#/cm3]
              BufferPos = 48;
              if ( (CRC.calcCRC8(SPSBuffer.slice(BufferPos,BufferPos+2)) == SPSBuffer.slice(BufferPos+2,BufferPos+3)) && (CRC.calcCRC8(SPSBuffer.slice(BufferPos+3,BufferPos+5)) == SPSBuffer.slice(BufferPos+5,BufferPos+6)) ) {
                debug('Number PM10 CRC ok');
                ResultBuffer[0] = SPSBuffer.slice(BufferPos,BufferPos+1);
                ResultBuffer[1] = SPSBuffer.slice(BufferPos+1,BufferPos+2);
                ResultBuffer[2] = SPSBuffer.slice(BufferPos+3,BufferPos+4);
                ResultBuffer[3] = SPSBuffer.slice(BufferPos+4,BufferPos+5);
                var NumberPM10 = new DataView(ResultBuffer.buffer).getFloat32(0);
              }
              else {
                let errMsg = `Number PM10 CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              //Typical Particle Size [nm]
              BufferPos = 54;
              if ( (CRC.calcCRC8(SPSBuffer.slice(BufferPos,BufferPos+2)) == SPSBuffer.slice(BufferPos+2,BufferPos+3)) && (CRC.calcCRC8(SPSBuffer.slice(BufferPos+3,BufferPos+5)) == SPSBuffer.slice(BufferPos+5,BufferPos+6)) ) {
                debug('Typical Particle Size CRC ok');
                ResultBuffer[0] = SPSBuffer.slice(BufferPos,BufferPos+1);
                ResultBuffer[1] = SPSBuffer.slice(BufferPos+1,BufferPos+2);
                ResultBuffer[2] = SPSBuffer.slice(BufferPos+3,BufferPos+4);
                ResultBuffer[3] = SPSBuffer.slice(BufferPos+4,BufferPos+5);
                var TypicalParticleSize = new DataView(ResultBuffer.buffer).getFloat32(0);
              }
              else {
                let errMsg = `Typical Particle Size CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              debug(`Mass Concentration PM1.0:  ${MassPM1} [μg/m3]`);
              debug(`Mass Concentration PM2.5:  ${MassPM2} [μg/m3]`);
              debug(`Mass Concentration PM4.0:  ${MassPM4} [μg/m3]`);
              debug(`Mass Concentration PM10:  ${MassPM10} [μg/m3]`);
              debug(`Number Concentration PM0.5:  ${NumberPM05} [#/cm3]`);
              debug(`Number Concentration PM1.0:  ${NumberPM1} [#/cm3]`);
              debug(`Number Concentration PM2.5:  ${NumberPM2} [#/cm3]`);
              debug(`Number Concentration PM4.0:  ${NumberPM4} [#/cm3]`);
              debug(`Number Concentration PM10:  ${NumberPM10} [#/cm3]`);
              debug(`Typical Particle Size:  ${TypicalParticleSize} [nm]`);

              let rsv = {
                'name': node.name,
                'timestamp': Util.getTimestamp(),
                'MassPM1.0': MassPM1,
                'MassPM2.5': MassPM2,
                'MassPM4.0': MassPM4,
                'MassPM10': MassPM10,
                'NumberPM0.5': NumberPM05,
                'NumberPM1.0': NumberPM1,
                'NumberPM2.5': NumberPM2,
                'NumberPM4.0': NumberPM4,
                'NumberPM10': NumberPM10,
                'TypicalParticleSize': TypicalParticleSize
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
  RED.nodes.registerType("sps30", sps30);

}
