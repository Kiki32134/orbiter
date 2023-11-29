import { BigNumber } from 'bignumber.js';
import { TransactionEntity } from './entities/transaction.entity';
import { Injectable } from '@nestjs/common';
import { EntityManager, getRepository } from 'typeorm';
import { PaginationResRO, CommonResRO, PaginationReqRO } from '../shared/interfaces';
import { logger, formateTimestamp, transforeUnmatchedTradding, cacheExchangeRates } from '../shared/utils';
import { groupBy, sumBy } from 'lodash';
import * as dayjs from 'dayjs';
import * as utc from 'dayjs/plugin/utc';
dayjs.extend(utc)
import { getRates } from '../shared/utils/maker-node'
@Injectable()
export class TransactionService {

  constructor(
    private readonly manager: EntityManager
  ) { }

  async findUnmatched(query): Promise<CommonResRO<any>> {
    let more = ``;
    if (query.startTime) {
      more += `and t.timestamp >= '${formateTimestamp(+query.startTime)}' `;
    }
    if (query.endTime) {
      more += `and t.timestamp <= '${formateTimestamp(+query.endTime)}' `;
    }
    // if (typeof query.status != 'undefined') {
    //   more += `and t.status = ${query.status} `
    // }
    if (query.makerAddress) {
      // more += `and m.replySender = '${query.makerAddress}' `
      const fromOrTo = query.fromOrToMaker == 1 ? 'from' : 'to'
      more += `and t.${fromOrTo} = '${query.makerAddress}'`
    }
    // fromOrToMaker 0: maker <<< to, 1: maker >>> from
    const inoutId = query.fromOrToMaker == 1 ? 'outId' : 'inId'
    const rInoutId = inoutId === 'outId' ? 'inId' : 'outId'
    // const sql = `
    //   select * from maker_transaction m left join transaction t on m.${inoutId} = t.id where m.${rInoutId} is null ${more} 
    //     order by t.timestamp DESC
    // `

    // const sql = `
    //   select * 
    //     from transaction t left join maker_transaction m on t.id = m.${inoutId} 
    //     where (t.status = '2' or t.status = '3') and m.${inoutId} is null ${more}
    // `

    const sql = `
      select t.id, t.chainId, t.hash, t.value, t.from, t.to, t.timestamp, t.status, t.tokenAddress, t.symbol as tokenName
        from transaction t left join maker_transaction m on t.id = m.${inoutId} 
        where (t.status = '1' and m.${rInoutId} is null ${more}) 
        or ((t.status = '2' or t.status = '3') ${more})
        order by t.timestamp DESC
    `

    logger.log(`[TransactionService.findUnmatched] ${sql.replace(/calcProfits+/g, ' ')}`)
    const data = await this.manager.query(sql);
    await transforeUnmatchedTradding(data);

    return {
      code: 0,
      msg: null,
      data,
    }
  }

  async findAll(query: PaginationReqRO): Promise<PaginationResRO<any>> {
    // const { makerAddress } = query;
    const cur = +query.current || 1;
    const limit = +query.size || 10;
    const offset = (cur - 1) * limit;

    let more = ``;
    if (query.startTime) {
      more += `${more ? 'and' : ''} t.timestamp >= '${formateTimestamp(+query.startTime)}' `;
    }
    if (query.endTime) {
      more += `${more ? 'and' : ''} t.timestamp <= '${formateTimestamp(+query.endTime)}' `;
    }
    let smid = ``
    if (query.makerAddress || more) {
      if (query.makerAddress) {
        smid = `where (t.from='${query.makerAddress}' or t.to='${query.makerAddress}') ${more}`
      } else {
        smid = `where ${more}`
      }
    }
    const commsql = `
      from transaction t ${smid}
        order by t.timestamp DESC
    `
    const sql = `
      select * ${commsql} LIMIT ${limit} OFFSET ${offset}
    `;
    logger.log(`[TransactionService.findAll] ${sql.replace(/\s+/g, ' ')}`)
    const datas = await this.manager.query(sql);
    const data = datas.slice(offset, offset + limit);

    const sqlOfTotal = `
      select COUNT(t.id) as sum 
        ${commsql}
    `
    logger.log(`[TransactionService.findAll count] ${sqlOfTotal.replace(/\s+/g, ' ')}`)
    const sumData = await this.manager.query(sqlOfTotal)
    const total = +sumData[0]?.sum || 0;
    // const total = datas.length;
    const pages = Math.ceil((total / limit));

    return {
      code: 0,
      current: cur,
      size: limit,
      total,
      pages,
      msg: null,
      data
    }
  }
  async statistics(query: any): Promise<any> {
    const startTime = Number(query['startTime']);
    const endTime = Number(query['endTime']);
    const whreeParmas: Array<any> = [
      dayjs(startTime).utc().toISOString(),
      dayjs(endTime).utc().toISOString(),
    ];
    let whereSql = " `timestamp`>=? AND `timestamp`<=? ";
    // let sqlLog = " `timestamp`>= '"+whreeParmas[0]+"' AND `timestamp`<= '" + whreeParmas[1] +"' ";
    let makerAddress = (query?.makerAddress || '').split(',');
      if (makerAddress.length > 0) {
          // whereSql += " and replySender in(?)";
          whereSql += " and `to` in(?)";
          whreeParmas.push(makerAddress);
      }
    if (query['fromChain']) {
      whereSql += ' and fromChain = ?';
      whreeParmas.push(query['fromChain']);
      // sqlLog += ` and fromChain = ${query['fromChain']}`;
    }
    if (query['toChain']) {
      whereSql += ' and toChain = ?';
      whreeParmas.push(query['toChain']);
      // sqlLog += ` and toChain = ${query['toChain']} `;
    }

    if (makerAddress.find(item => item.toLowerCase() === "0xd7aa9ba6caac7b0436c91396f22ca5a7f31664fc")) {
      whereSql += ' and inSymbol = ?';
      whreeParmas.push("USDT");
    }
    if (makerAddress.find(item => item.toLowerCase() === "0x41d3d33156ae7c62c094aae2995003ae63f587b3")) {
      whereSql += ' and inSymbol = ?';
      whreeParmas.push("USDC");
    }
    if (makerAddress.find(item => item.toLowerCase() === "0x095d2918b03b2e86d68551dcf11302121fb626c9")) {
      whereSql += ' and inSymbol = ?';
      whreeParmas.push("DAI");
    }

    // console.log('from', "SELECT count(1) as trxCount,sum(inValue) AS value,inSymbol AS symbol FROM statistics WHERE " + sqlLog + " GROUP BY inSymbol");
    // console.log('to', "SELECT sum(outValue) AS `value`,outSymbol AS symbol,sum(outFee) AS fee,outFeeToken AS feeToken FROM statistics WHERE " + sqlLog + " GROUP BY outSymbol,outFeeToken");
    // const from = await this.manager.query("SELECT count(1) as trxCount,sum(inValue) AS value,inSymbol AS symbol FROM statistics WHERE " + whereSql + " GROUP BY inSymbol", whreeParmas);
    // const to = await this.manager.query("SELECT sum(outValue) AS `value`,outSymbol AS symbol,sum(outFee) AS fee,outFeeToken AS feeToken FROM statistics WHERE " + whereSql + " GROUP BY outSymbol,outFeeToken", whreeParmas);
    console.log("sql","SELECT count(1) as trxCount,sum(inValue) AS value,inSymbol AS symbol,fromChain AS chainId FROM statistics WHERE " + whereSql + " GROUP BY inSymbol,fromChain", whreeParmas)
    const from = await this.manager.query("SELECT count(1) as trxCount,sum(inValue) AS value,inSymbol AS symbol,fromChain AS chainId FROM statistics WHERE " + whereSql + " GROUP BY inSymbol,fromChain", whreeParmas);
    const to = await this.manager.query("SELECT sum(outValue) AS `value`,outSymbol AS symbol,sum(outFee) AS fee,outFeeToken AS feeToken,toChain AS chainId FROM statistics WHERE " + whereSql + " GROUP BY outSymbol,outFeeToken,toChain", whreeParmas);
    for (const row of from) {
      row.value = this.divPrecision(row.symbol, row.value, row.chainId);
    }
    for (const row of to) {
      row.value = this.divPrecision(row.symbol, row.value, row.chainId);
      row.fee = this.divPrecision(row.feeToken, row.fee, row.chainId);
    }
    const profit: any = {};
    for (const symbol of ['USD', 'CNY', 'ETH', 'USDC', 'USDT', 'BTC', 'DAI', 'BNB']) {
      try {
        profit[symbol] = Number(await this.calcProfit(symbol, from, to)).toFixed(6);
      } catch (err) {
        console.error(err);
      }
    }
    let fromAmount = 0;
    let toAmount = 0;
    let profitAmount = 0;
    if (makerAddress.find(item=>item.toLowerCase() === '0x80C67432656d59144cEFf962E8fAF8926599bCF8'.toLowerCase()) ||
        makerAddress.find(item=>item.toLowerCase() === '0xe4edb277e41dc89ab076a1f049f4a3efa700bce8'.toLowerCase())) {
      fromAmount = sumBy(from, 'ETHValue').toFixed(6);
      toAmount = sumBy(to, 'ETHValue').toFixed(6);
      profitAmount = profit['ETH'];
    } else if (makerAddress.find(item => item.toLowerCase() === '0xd7Aa9ba6cAAC7b0436c91396f22ca5a7F31664fC'.toLowerCase())) {
      fromAmount = sumBy(from, 'USDTValue').toFixed(6);
      toAmount = sumBy(to, 'USDTValue').toFixed(6);
      profitAmount = profit['USDT'];
    } else if (makerAddress.find(item => item.toLowerCase() === '0x41d3D33156aE7c62c094AAe2995003aE63f587B3'.toLowerCase())) {
      fromAmount = sumBy(from, 'USDCValue').toFixed(6);
      toAmount = sumBy(to, 'USDCValue').toFixed(6);
      profitAmount = profit['USDC'];
    } else if (makerAddress.find(item => item.toLowerCase() === '0x095D2918B03b2e86D68551DCF11302121fb626c9'.toLowerCase())) {
      fromAmount = sumBy(from, 'DAIValue').toFixed(6);
      toAmount = sumBy(to, 'DAIValue').toFixed(6);
      profitAmount = profit['DAI'];
    }
    return {
      from,
      to,
      trxCount: sumBy(from, (row) => {
        return Number(row.trxCount);
      }),
      profit,
      profitAmount,
      fromAmount,
      toAmount,
      dbQuery: whreeParmas
    }

  }
  public divPrecision(symbol: string, value: string, chainId) {
    let amount = new BigNumber(0);
    switch (symbol) {
      case 'ETH':
      case 'MATIC':
      case 'METIS':
      case 'BNB':
      case 'DAI':
        amount = new BigNumber(value).dividedBy(10 ** 18);
        break;
      case 'USDC':
      case 'USDT':
        if (+chainId === 15) {
          amount = new BigNumber(value).dividedBy(10 ** 18);
        } else {
          amount = new BigNumber(value).dividedBy(10 ** 6);
        }
        break;

    }
    return amount.toString();
  }
  public async convertRate(from: string, to: string, value: string): Promise<number> {
    const ratesbyTo = await cacheExchangeRates(to);
    if (ratesbyTo[from]) {
      return new BigNumber(value).dividedBy(ratesbyTo[from]).toNumber();
    }
    // 
    const ratesbyFrom = await cacheExchangeRates(from);
    if (ratesbyFrom[to]) {
      return new BigNumber(value).multipliedBy(ratesbyTo[to]).toNumber();
    }
    logger.error(`[Coinbase Exchange rate not obtained] From:${from}, FromValue:${value}, To:${to}`);
    return 0;
  }
  public async calcProfit(symbol: string, fromList: Array<any>, toList: Array<any>) {
    let fromSymbolTotal = new BigNumber(0);
    let toSymbolTotal = new BigNumber(0);
    let feeSymbolTotal = new BigNumber(0);
    // calc from
    for (const row of fromList) {
      const fromValue = row['value'];
      if (row['symbol'] === symbol) {
        fromSymbolTotal = fromSymbolTotal.plus(fromValue);
        row[`${symbol}Value`] = Number(fromValue);
        continue;
      }
      const rateValue = await this.convertRate(row.symbol, symbol, fromValue);
      row[`${symbol}Value`] = Number(rateValue);
      fromSymbolTotal = fromSymbolTotal.plus(rateValue);
      // convert symbol
    }
    // calc to
    for (const row of toList) {
      const toValue = row['value'];
      if (row['symbol'] === symbol) {
        row[`${symbol}Value`] = Number(toValue);
        toSymbolTotal = toSymbolTotal.plus(toValue);
        continue;
      }
      const rateValue = await this.convertRate(row.symbol, symbol, toValue);
      row[`${symbol}Value`] = Number(rateValue);
      toSymbolTotal = toSymbolTotal.plus(rateValue);
      // convert symbol
    }
    // calc fee
    for (const row of toList) {
      const feeValue = row['fee'];
      if (row['feeToken'] === symbol) {
        feeSymbolTotal = feeSymbolTotal.plus(feeValue);
        continue;
      }
      const rateValue = await this.convertRate(row.feeToken, symbol, feeValue);
      feeSymbolTotal = feeSymbolTotal.plus(rateValue);
      // convert symbol
    }
    // console.log('fromSymbolTotal:', fromSymbolTotal.toString());
    // console.log('toSymbolTotal:', toSymbolTotal.toString());
    // console.log('feeSymbolTotal:', feeSymbolTotal.toString());
    return fromSymbolTotal.minus(toSymbolTotal).minus(feeSymbolTotal);
  }
}
