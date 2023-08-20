import * as core from '@actions/core'
import * as github from '@actions/github'
import * as io from '@actions/io'
import * as child_process from 'child_process'
import * as fs from 'fs/promises'
import { isFileExist } from './src/isFileExists.js'
import { writeFolderListing } from './src/writeFolderListing.js'

const baseDir = 'allure-action'
const getBranchName = (gitRef: string) => gitRef.replace('refs/heads/', '')

const spawnAllure = async (allureResultsDir: string, allureReportDir: string) => {
    const allureChildProcess = child_process.spawn('/allure-commandline/bin/allure', [
        'generate',
        '--clean',
        allureResultsDir,
        '-o',
        allureReportDir,
    ])
    const generation = new Promise<void>((resolve, reject) => {
        allureChildProcess.once('error', reject)
        allureChildProcess.once('exit', (code: unknown) => (code === 0 ? resolve() : reject(code)))
    })

    return generation
}

const getLastRunId = async (reportBaseDir: string) => {
    const dataFile = `${reportBaseDir}/lastRun.json`

    if (await isFileExist(dataFile)) {
        const lastRun: LastRunJson = JSON.parse((await fs.readFile(dataFile)).toString('utf-8'))
        return lastRun.runId
    } else {
        return null
    }
}

const writeLastRunId = async (reportBaseDir: string, runId: number) => {
    const dataFile = `${reportBaseDir}/lastRun.json`

    await fs.writeFile(dataFile, JSON.stringify({ runId }, null, 2))
}

const updateDataJson = async (reportBaseDir: string, reportDir: string, runId: number) => {
    const summaryJson: AllureSummaryJson = JSON.parse((await fs.readFile(`${reportDir}/widgets/summary.json`)).toString('utf-8'))
    const dataFile = `${reportBaseDir}/data.json`
    let dataJson: AllureRecord[]

    if (await isFileExist(dataFile)) {
        dataJson = JSON.parse((await fs.readFile(dataFile)).toString('utf-8'))
    } else {
        dataJson = []
    }

    const testResult: AllureRecordTestResult =
        summaryJson.statistic.broken + summaryJson.statistic.failed > 0 ? 'FAIL' : summaryJson.statistic.passed > 0 ? 'PASS' : 'UNKNOWN'
    const record: AllureRecord = {
        runId,
        testResult,
        timestamp: summaryJson.time.start,
        summary: {
            statistic: summaryJson.statistic,
            time: summaryJson.time,
        },
    }
    dataJson.unshift(record)
    await fs.writeFile(dataFile, JSON.stringify(dataJson, null, 2))
}

try {
    // vars
    const sourceReportDir = core.getInput('report_dir')
    const ghPagesPath = core.getInput('gh_pages')
    const reportId = core.getInput('report_id')
    const branchName = getBranchName(github.context.ref)
    const reportBaseDir = `${ghPagesPath}/${baseDir}/${branchName}/${reportId}`
    const reportDir = `${reportBaseDir}/${github.context.runId}`

    // log
    console.table({ ghPagesPath, sourceReportDir, reportId, branchName, reportBaseDir, reportDir, gitref: github.context.ref })
    // context
    const toLog = { ...github.context } as Record<string, unknown>
    delete toLog.payload
    console.log('toLog', toLog)

    // action
    await io.mkdirP(reportBaseDir)

    // folder listing
    // do noot overwrite index.html in the folder root to avoid conflicts
    if (!(await isFileExist(`${ghPagesPath}/index.html`))) {
        await writeFolderListing(ghPagesPath, '.')
    }
    await writeFolderListing(ghPagesPath, baseDir)

    // process report
    const lastRunId = await getLastRunId(reportBaseDir)
    console.log('lastRunId', lastRunId)
    if (lastRunId) {
        await io.cp(`${reportBaseDir}/${lastRunId}/history`, sourceReportDir, { recursive: true })
    }
    await spawnAllure(sourceReportDir, reportDir)
    await updateDataJson(reportBaseDir, reportDir, github.context.runId)
    // write index.html to show allure records
    // await writeFolderListing(ghPagesPath, `${baseDir}/${branchName}`)
    await writeLastRunId(reportBaseDir, github.context.runId)
} catch (error) {
    core.setFailed(error.message)
}