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

  const SCD30Address = 0x61;

  const commandMeasureContinous_MSB = 0x00;
  const commandMeasureContinous_LSB = 0x10;
  const commandMeasureContinous_CRC = 0x81;
  const commandSetAltitude_MSB = 0x51;
  const commandSetAltitude_LSB = 0x02;
  const commandSetTemperatureOffset_MSB = 0x54;
  const commandSetTemperatureOffset_LSB = 0x03;
  const commandStopMeasureContinous_MSB = 0x01;
  const commandStopMeasureContinous_LSB = 0x04;
  const commandGetDataReady_MSB = 0x02;
  const commandGetDataReady_LSB = 0x02;
  const commandReadMeasurement_MSB = 0x03;
  const commandReadMeasurement_LSB = 0x00;

  let i2cBus = undefined;

  // The main node definition - most things happen in here
  function scd30(config) {

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

    node.address = SCD30Address;
    node.name = `SCD30 @ 0x${node.address.toString(16)}`;
    node.altitude = config.altitude;
    //node.mResolution = MRES.get(config.mRes);
    //debug(JSON.stringify(node.mResolution));

    // 2. Initialize Sensor
    node.ready = false;
    node.status({fill: "green", shape: "ring", text: "SCD30 sensor initializing"});

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
    node.emit('sensor_ready');

    // respond to inputs....
    this.on('input', (msg) => {
      let command = msg.payload; // One of:  measure, set_config, get_config, ... TODO - add other input types support
      if (command) {
        if ("measure" === command) {

          let now = Date.now();

          measure(node).then((resolve) => {

            node.send([
              {topic: 'SCD30', payload: resolve}
            ]);

          }, (reject) => {
            msg.payload = `${reject}`;
            node.send(msg);
          });

        } else if ("startContinous" === command) {
          startContinous(node);
          debug(`startContinous`);
        }
        else if ("setAltitude" === command) {
          setAltitude(node);
        }
        else if ("getAltitude" === command) {
          getAltitude(node);
        }
        else if ("setTemperatureOffset" === command) {
          setTemperatureOffset(node);
        }
        else if ("getTemperatureOffset" === command) {
          getTemperatureOffset(node);
        }
      }
    });

    this.on("close", () => {
      debug("close");
      // Called when the node is shutdown - eg on redeploy.
      // Allows ports to be closed, connections dropped etc.
      // eg: node.client.disconnect();
    });

    function startContinous() {
      let SCDWriteBuffer = new Uint8Array([commandMeasureContinous_MSB, commandMeasureContinous_LSB, 0, 0, commandMeasureContinous_CRC]);
      i2cBus.i2cWrite(node.address, SCDWriteBuffer.length, SCDWriteBuffer, (err) => {
        if (err) {
          let errMsg = `send read command error:  ${err}`;
          node.error(errMsg);
        }
        node.status({fill: "green", shape: "ring", text: "SCD30 start continous"});
      });
    }

    function setTemperatureOffset() {
      let SCDWriteBuffer = new Uint8Array([commandSetTemperatureOffset_MSB, commandSetTemperatureOffset_LSB, 0x00, 0xF0, 0x3]);
      i2cBus.i2cWrite(node.address, SCDWriteBuffer.length, SCDWriteBuffer, (err) => {
        if (err) {
          let errMsg = `send setTemperatureOffset command error:  ${err}`;
          node.error(errMsg);
        }
        node.status({fill: "green", shape: "ring", text: "SCD30 set temperature offset"});
      });
    }

    function setAltitude() {
      let SCDWriteBuffer = new Uint8Array([commandSetAltitude_MSB, commandSetAltitude_LSB, 0x01, 0x22, 0x91]);
      i2cBus.i2cWrite(node.address, SCDWriteBuffer.length, SCDWriteBuffer, (err) => {
        if (err) {
          let errMsg = `send read command error:  ${err}`;
          node.error(errMsg);
        }
        node.status({fill: "green", shape: "ring", text: "SCD30 set altitude"});
      });
    }

    function getAltitude() {
      return new Promise((resolve, reject) => {
        let ResultBuffer = new Uint8Array(3);

        // Start readout
        i2cBus.writeByte(node.address, commandSetAltitude_MSB, commandSetAltitude_LSB, (err) => {
          if (err) {
            let errMsg = `send read data error:  ${err}`;
            node.error(errMsg);
            reject(errMsg);
          }
          node.status({fill: "green", shape: "ring", text: "SCD30 send read altitude"});
        });
        i2cBus.i2cRead(node.address, ResultBuffer.length, ResultBuffer, (err, bytesRead, buffer) => {
          if (err) {
            let errMsg = `read data error:  ${err}`;
            node.error(errMsg);
            reject(errMsg);
          } else {
            let altitude = new DataView(ResultBuffer.buffer).getUint16(0);
            debug(`Altitude:  ${altitude} m`);
          };
          resolve();
        });
      });
    }

    function getTemperatureOffset() {
      return new Promise((resolve, reject) => {
        let ResultBuffer = new Uint8Array(3);

        // Start readout
        i2cBus.writeByte(node.address, commandSetTemperatureOffset_MSB, commandSetTemperatureOffset_LSB, (err) => {
          if (err) {
            let errMsg = `send read data error:  ${err}`;
            node.error(errMsg);
            reject(errMsg);
          }
          node.status({fill: "green", shape: "ring", text: "SCD30 send read temperature offset"});
        });
        i2cBus.i2cRead(node.address, ResultBuffer.length, ResultBuffer, (err, bytesRead, buffer) => {
          if (err) {
            let errMsg = `read data error:  ${err}`;
            node.error(errMsg);
            reject(errMsg);
          } else {
            let temperatureOffset = new DataView(ResultBuffer.buffer).getUint16(0);
            debug(`Temperature Offset:  ${temperatureOffset} \u2103`);
          };
          resolve();
        });
      });
    }

    function getDataReady() {
      i2cBus.writeByte(node.address, commandGetDataReady_MSB, commandGetDataReady_LSB, (err) => {
        if (err) {
          let errMsg = `send read check error:  ${err}`;
          node.error(errMsg);
          reject(errMsg);
        }
        node.status({fill: "green", shape: "ring", text: "SCD30 write data ready"});
      });

      i2cBus.i2cRead(node.address, SCDWordCRC.length, SCDWordCRC, (err, bytesRead, buffer) => {
        if (err) {
          return 0;
        } else {
          return 1;
        }
        node.status({fill: "green", shape: "ring", text: "SCD30 read data ready"});
      });
    }

    function measure() {
      return new Promise((resolve, reject) => {
        let SCDBuffer = new Uint8Array(18);
        let SCDWord = new Uint8Array(2);
        let SCDWordCRC = new Uint8Array(3);
        let ResultBuffer = new Uint8Array(4);

        // Start readout
        if (getDataReady) {
          i2cBus.writeByte(node.address, commandReadMeasurement_MSB, commandReadMeasurement_LSB, (err) => {
            if (err) {
              let errMsg = `send read data error:  ${err}`;
              node.error(errMsg);
              reject(errMsg);
            }
            node.status({fill: "green", shape: "ring", text: "SCD30 send read data cmd"});
          });

          i2cBus.i2cRead(node.address, SCDBuffer.length, SCDBuffer, (err, bytesRead, buffer) => {
            if (err) {
              let errMsg = `read data error:  ${err}`;
              node.error(errMsg);
              reject(errMsg);
            } else {
              // debug(CRC.calcCRC8(SCDWord));
              // debug(SCDBuffer.slice(2,3));
              if ((CRC.calcCRC8(SCDBuffer.slice(0,2)) == SCDBuffer.slice(2,3)) && (CRC.calcCRC8(SCDBuffer.slice(3,5)) == SCDBuffer.slice(5,6))) {
                debug('CO2 CRC ok');
                //Collect CO2 data in array
                ResultBuffer[0] = SCDBuffer.slice(0,1);
                ResultBuffer[1] = SCDBuffer.slice(1,2);
                ResultBuffer[2] = SCDBuffer.slice(3,4);
                ResultBuffer[3] = SCDBuffer.slice(4,5);
                var CO2 = new DataView(ResultBuffer.buffer).getFloat32(0);
              }
              else {
                let errMsg = `CO2 CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              //Collect Temperature data in array
              if ((CRC.calcCRC8(SCDBuffer.slice(6,8)) == SCDBuffer.slice(8,9)) && (CRC.calcCRC8(SCDBuffer.slice(9,11)) == SCDBuffer.slice(11,12))) {
                debug('Tc CRC ok');
                ResultBuffer[0] = SCDBuffer.slice(6,7);
                ResultBuffer[1] = SCDBuffer.slice(7,8);
                ResultBuffer[2] = SCDBuffer.slice(9,10);
                ResultBuffer[3] = SCDBuffer.slice(10,11);
                var Tc = new DataView(ResultBuffer.buffer).getFloat32(0);
              }
              else {
                let errMsg = `Tc CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              //Collect Humidity data in array
              if ((CRC.calcCRC8(SCDBuffer.slice(12,14)) == SCDBuffer.slice(14,15)) && (CRC.calcCRC8(SCDBuffer.slice(15,17)) == SCDBuffer.slice(17,18))) {
                debug('RH CRC ok');
                ResultBuffer[0] = SCDBuffer.slice(12,13);
                ResultBuffer[1] = SCDBuffer.slice(13,14);
                ResultBuffer[2] = SCDBuffer.slice(15,16);
                ResultBuffer[3] = SCDBuffer.slice(16,17);
                var RH = new DataView(ResultBuffer.buffer).getFloat32(0);
              }
              else {
                let errMsg = `RH CRC error`;
                node.error(errMsg);
                reject(errMsg);
              }

              debug(`CO2:  ${CO2} ppm`);
              debug(`Temperature:  ${Tc} \u2103`);
              debug(`RH:  ${RH} %`);
              let DPc = Util.roundValue(Util.computeDewpoint(Tc, RH));

              let rsv = {
                'name': node.name,
                'timestamp': Util.getTimestamp(),
                'CO2': CO2,
                'Tc': Tc,
                'RH': RH,
                'DPc': DPc
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
  RED.nodes.registerType("scd30", scd30);

}
