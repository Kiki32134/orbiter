import { appConfig, makerConfig } from '../config'
import { sleep } from '../util'
import { accessLogger, errorLogger } from '../util/logger'
import { getMakerList } from '../util/maker'
import { startNewMakerTrxPull } from '../util/maker/new_maker'
import {
  batchTxSend,
  jobBalanceAlarm,
  jobGetWealths,
  watchLogs,
} from './jobs';
import { doSms } from '../sms/smsSchinese'
import { telegramBot } from '../sms/telegram'

let smsTimeStamp = 0

export async function waittingStartMaker() {
  const makerList = await getMakerList()
  if (makerList.length === 0) {
    accessLogger.warn('none maker list')
    return
  }
  // wait makerConfig.privateKeys
  const startedIndexs: number[] = []
  let isPrivateKeysChanged = true

  while (startedIndexs.length < makerList.length) {
    const missPrivateKeyMakerAddresses: string[] = []
    for (let index = 0; index < makerList.length; index++) {
      const item = makerList[index]
      const makerAddress = item.makerAddress
      if (
        makerConfig.privateKeys[makerAddress.toLowerCase()] &&
        startedIndexs.indexOf(index) === -1
      ) {
        // jobMakerNodeTodo(item.makerAddress)
        startedIndexs.push(index)
        isPrivateKeysChanged = true

        // Deley run, fixed bug: "Max rate limit reached, rate limit of 5/1sec applied"
        await sleep(200)

        continue
      }

      var myDate = new Date()
      let nowTime = myDate.valueOf()

      let alert =
        `${makerAddress}` +
        ' Waitting for the privateKey ' +
        myDate.getHours() +
        ':' +
        myDate.getMinutes() +
        ':' +
        myDate.getSeconds()

      if (nowTime > smsTimeStamp && nowTime - smsTimeStamp > 30000) {
        try {
          doSms(alert)
          telegramBot.sendMessage(alert).catch(error => {
            accessLogger.error(`send telegram message error ${error.stack}`);
          })
          accessLogger.info(
            `sendNeedPrivateKeyMessage,   smsTimeStamp = ${nowTime}`
          )
        } catch (error) {
          errorLogger.error(`sendPrivateSMSError = ${error}`)
        }
        smsTimeStamp = nowTime
      }
      if (startedIndexs.indexOf(index) === -1) {
        missPrivateKeyMakerAddresses.push(makerAddress)
      }
    }

    // Only first waiting or privateKeys changed
    if (isPrivateKeysChanged && missPrivateKeyMakerAddresses.length > 0) {
      const curlBody = {}
      for (const item of missPrivateKeyMakerAddresses) {
        curlBody[item] = "This maker's private key"
      }

      accessLogger.warn(
        `Miss private keys!`,
        `Please run [curl -i -X POST -H 'Content-type':'application/json' -d '${JSON.stringify(
          curlBody
        )}' http://${appConfig.options.host}:${appConfig.options.port
        }/maker/privatekeys] set it`
      )

      isPrivateKeysChanged = false
    }

    await sleep(1000)
  }
}

export const startMasterJobs = async () => {
  const scene = process.env.ORBITER_SCENE

  // cache coinbase
  // jobCacheCoinbase()

  // pull makerList

  // dashboard
  if (['dashboard', 'all', undefined, ''].indexOf(scene) !== -1) {
    // get wealths
    jobGetWealths()

    jobBalanceAlarm()
  }
  // maker
  if (['maker', 'all', undefined, ''].indexOf(scene) !== -1) {
    waittingStartMaker()
    startNewMakerTrxPull()
    batchTxSend()
    watchLogs();
  }
}

export const startWorkerJobs = async () => {
  //   const scene = process.env.ORBITER_SCENE
  //   // maker
  //   if (['maker', 'all', undefined, ''].indexOf(scene) !== -1) {
  //     waittingStartMaker()
  //     startNewMakerTrxPull()
  //   }
}
