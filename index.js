const ethers = require("ethers");
const cron = require("node-cron");
const express = require("express");
const { default: axios } = require("axios");
const dayjs = require("dayjs");
const oracleAbi = require("./oracle_abi.json");

const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

require("dotenv").config();

dayjs.extend(utc);
dayjs.extend(timezone);

let cacheJbcToUsdData;
let cacheUsdToThbData;
let lastUpdateAt;

function isPriceDataReady() {
  return !!cacheJbcToUsdData && !!cacheUsdToThbData;
}

function getPackedData() {
  if (!isPriceDataReady()) {
    return undefined;
  }

  const baseData = {
    jbcToUsd: cacheJbcToUsdData,
    usdToThb: cacheUsdToThbData,
    lastUpdateAt: lastUpdateAt,
  };
  return {
    ...baseData,
    jbcToThb: baseData.jbcToUsd * baseData.usdToThb,
  };
}
/**
 * @param {ethers.Contract} contract
 */
async function getJBCtoUSDLastestPrice(oracleContract) {
  const rawPrice = await oracleContract.getLatestPrice();

  return parseFloat(`${rawPrice}`) / 1e8;
}

async function getUSBtoTHBRate() {
  const endTime = dayjs()
    .tz("Asia/Bangkok")
    .subtract(1, "day")
    .format("YYYY-MM-DD");

  const response = await axios.get(
    `https://apigw1.bot.or.th/bot/public/Stat-ExchangeRate/v2/DAILY_AVG_EXG_RATE/?start_period=${endTime}&end_period=${endTime}&currency=USD`,
    {
      headers: {
        "x-ibm-client-id": "172a31ab-57fc-4b48-bd49-b5d40771c18b",
        accept: "application/json",
      },
    }
  );

  const resultRaw = response.data.result.data.data_detail[0];
  return parseFloat(resultRaw.selling);
}

(async () => {
  getUSBtoTHBRate().catch(console.error);
  const jibProvider = new ethers.JsonRpcProvider("https://rpc-l1.jibchain.net");
  const oracleContract = new ethers.Contract(
    "0xA21B21fe4263Ef932D0359E1e733a54f1838f793",
    oracleAbi,
    jibProvider
  );

  const task1 = async () => {
    try {
      console.log("JBC to USD Price Task");
      cacheJbcToUsdData = await getJBCtoUSDLastestPrice(oracleContract);
      lastUpdateAt = !lastUpdateAt
        ? new Date()
        : dayjs().diff(lastUpdateAt) > 0
        ? new Date()
        : lastUpdateAt;

      console.log(getPackedData() || "Not ready");
    } catch (err) {
      console.error(err);
    }
  };

  cron.schedule("* * * * *", task1);
  task1();

  const task2 = async () => {
    try {
      console.log("THB to USD Price Task");
      cacheUsdToThbData = await getUSBtoTHBRate(oracleContract);
      lastUpdateAt = !lastUpdateAt
        ? new Date()
        : dayjs().diff(lastUpdateAt) > 0
        ? new Date()
        : lastUpdateAt;

      console.log(getPackedData() || "Not ready");
    } catch (err) {
      console.error(err);
    }
  };

  cron.schedule("*/5 * * * *", task2);
  task2();

  const webApp = express();
  webApp.get("/", (req, res) => {
    if (!isPriceDataReady()) {
      res.status(500).send({
        err: "Price data not ready",
      });
    }

    res.status(200).send(getPackedData());
  });

  webApp.listen(process.env.PORT || 3066, () => {
    console.log("Oracle API Webserver Started");
  });
})();
