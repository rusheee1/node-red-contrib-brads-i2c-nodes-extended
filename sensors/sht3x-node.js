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

  const SHT3xAddress = 0x44;

  const shtWrite = SHT3xAddress << 1;
  const shtRead = SHT3xAddress << 1 | 0x01;

  const commandMeasureStretchingHigh_MSB = 0x2C;
  const commandMeasureStretchingHigh_LSB = 0x06;
  const commandMeasureNoStretchingHigh_MSB = 0x24;
  const commandMeasureNoStretchingHigh_LSB = 0x00;
  const commandMeasureNoStretchingHigh = 0x2400;
  const commandMeasureStretchingMedium = 0x2C0D;
  const commandMeasureNoStretchingMedium = 0x240B;
  const commandReadStatusRegister = 0xF32D;
  const commandResetStatusRegister = 0x3041;
  const commandSoftReset = 0x30A2;


  let i2cBus = undefined;

  // The main node definition - most things happen in here
  function sht3x(config) {

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

    node.address = SHT3xAddress;
    node.name = `SHT3x @ 0x${node.address.toString(16)}`;

    // 2. Initialize Sensor
    node.ready = false;
    node.status({fill: "green", shape: "ring", text: "SHT3x sensor initializing"});

    if (i2cBus == undefined) {
      i2cBus = i2c.openSync(1);
      // if (!i2cBus) {
      //   node.error(`problem initializing i2c bus.`);
      //   node.status({fill: "red", shape: "ring", text: `problem initializing i2c bus.`});
      // }
      debug("opened i2cBus -> " + i2cBus);
    }

    // let init = new Promise((resolve, reject) => {
    //   i2cBus.writeByte(node.address, commandWriteUserRegister, (node.mResolution.value | disableOTPReload), (err) => {
    //     if (err) {
    //       let errMsg = `${node.name} set user config returned an error:  ${err}`;
    //       node.error(errMsg);
    //       node.status({fill: "red", shape: "ring", text: errMsg});
    //       reject(errMsg);
    //     } else {
    //       resolve(`htu1d set user config succeeded`);
    //     }
    //   });
    // });

    // init.then((resolvedMsg) => {
    //   node.ready = true;
    //   node.emit('sensor_ready', resolvedMsg);
    // }, (rejectMsg) => {
    //   node.status({fill: "red", shape: "ring", text: `${node.name} check configuration:  ${rejectMsg}`});
    //   node.error(`${rejectMsg}:  node.ready -> ${node.ready}:  , node.deviceId -> ${node.deviceId}`);
    // });

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
              {topic: 'SHT3x', payload: resolve}
            ]);

          }, (reject) => {
            msg.payload = `${reject}`;
            node.send(msg);
          });

        } else if ("Vdd Status" === command) {
          // TODO - read user register bit 6:  0:  VDD > 2.25V,   1:  VDD < 2.25V
        }
      }
    });

    this.on("close", () => {
      debug("close");
      // Called when the node is shutdown - eg on redeploy.
      // Allows ports to be closed, connections dropped etc.
      // eg: node.client.disconnect();
    });

    function measure() {
      return new Promise((resolve, reject) => {
        let SHTBuffer = new Uint8Array(6);

        i2cBus.writeByte(node.address, commandMeasureStretchingHigh_MSB, commandMeasureStretchingHigh_LSB, (err) => {
          if (err) {
            let errMsg = `send read command error:  ${err}`;
            node.error(errMsg);
            reject(errMsg);
          } else {
              i2cBus.i2cRead(node.address, SHTBuffer.length, SHTBuffer, (err, bytesRead, buffer) => {
                if (err) {
                  let errMsg = `read data error:  ${err}`;
                  node.error(errMsg);
                  reject(errMsg);
                } else {
                  //debug("BUFFER:" + buffer);
                  let dataView = new DataView(buffer.buffer);
                  let Tc = Util.roundValue(new BigNumber(dataView.getUint16(0), 10).div(65535).times('175').minus('45'));
                  //let Tf = Util.roundValue(Util.roundValue(Tc * 1.8 + 32.0));

                  debug(`Temperature:  ${Tc} \u2103`);
                  // calculate relative humidity
                  let RH = Util.roundValue(new BigNumber(dataView.getUint16(3)).div(65535).times(100));
                  debug(`RH:  ${RH} %`);
                  let DPc = Util.roundValue(Util.computeDewpoint(Tc, RH));
                  //let DPf = Util.roundValue(DPc * 1.8 + 32.0);

                  let rsv = {
                    'name': node.name,
                    'timestamp': Util.getTimestamp(),
                    'Tc': Tc,
                    'RH': RH,
                    'DPc': DPc
                  };
                  resolve(rsv);
                }
              });
          }
        });
      });
    }
  }

  // Register the node by name. This must be called before overriding any of the
  // Node functions.
  RED.nodes.registerType("sht3x", sht3x);

}
