const safeText = (value, fallback = 'Unknown error') => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return (text || fallback).slice(0, 200)
}

const isAlreadyCheckedIn = (action) => {
  if (!action?.code) return false
  return /please\s+try\s+tomorrow|already\s+checked|checked\s+in/i.test(
    safeText(action?.message, '')
  )
}

const glados = async () => {
  const notice = []
  let failed = false
  let hasCookie = false

  if (!process.env.GLADOS) {
    return {
      notice: ['Checkin Error', 'GLADOS secret is missing'],
      failed: true,
    }
  }

  for (const cookie of String(process.env.GLADOS).split('\n')) {
    if (!cookie) continue
    hasCookie = true
    try {
      const common = {
        'cookie': cookie,
        'referer': 'https://glados.cloud/console/checkin',
        'user-agent': 'Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 6.0)',
      }
      const actionResponse = await fetch('https://glados.cloud/api/user/checkin', {
        method: 'POST',
        headers: { ...common, 'content-type': 'application/json' },
        body: '{"token":"glados.cloud"}',
      })
      if (!actionResponse.ok) {
        throw new Error(`Checkin HTTP ${actionResponse.status}`)
      }
      const action = await actionResponse.json()
      const alreadyCheckedIn = isAlreadyCheckedIn(action)
      if (action?.code && !alreadyCheckedIn) {
        throw new Error(safeText(action?.message, `Checkin API code ${action.code}`))
      }

      const statusResponse = await fetch('https://glados.cloud/api/user/status', {
        method: 'GET',
        headers: { ...common },
      })
      if (!statusResponse.ok) {
        throw new Error(`Status HTTP ${statusResponse.status}`)
      }
      const status = await statusResponse.json()
      if (status?.code) {
        throw new Error(safeText(status?.message, `Status API code ${status.code}`))
      }

      notice.push(
        alreadyCheckedIn ? 'Already checked in' : 'Checkin OK',
        alreadyCheckedIn
          ? 'The account was already checked in today'
          : safeText(action?.message, 'Checkin completed'),
        `Left Days ${Number(status?.data?.leftDays)}`
      )
    } catch (error) {
      failed = true
      notice.push(
        'Checkin Error',
        safeText(error?.message),
        `<${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}>`
      )
    }
  }

  if (!hasCookie) {
    return {
      notice: ['Checkin Error', 'GLADOS secret is empty'],
      failed: true,
    }
  }

  return { notice, failed }
}

const notify = async (notice) => {
  if (!process.env.NOTIFY || !notice) return
  for (const option of String(process.env.NOTIFY).split('\n')) {
    if (!option) continue
    try {
      if (option.startsWith('console:')) {
        for (const line of notice) {
          console.log(line)
        }
      } else if (option.startsWith('wxpusher:')) {
        await fetch(`https://wxpusher.zjiecode.com/api/send/message`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            appToken: option.split(':')[1],
            summary: notice[0],
            content: notice.join('<br>'),
            contentType: 3,
            uids: option.split(':').slice(2),
          }),
        })
      } else if (option.startsWith('pushplus:')) {
        await fetch(`https://www.pushplus.plus/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: option.split(':')[1],
            title: notice[0],
            content: notice.join('<br>'),
            template: 'markdown',
          }),
        })
      } else if (option.startsWith('qyweixin:')) {
        const qyweixinToken = option.split(':')[1]
        const qyweixinNotifyRebotUrl = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' + qyweixinToken;
        await fetch(qyweixinNotifyRebotUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            msgtype: 'markdown',
            markdown: {
                content: notice.join('<br>')
            }
          }),
        })
      } else {
        // fallback
        await fetch(`https://www.pushplus.plus/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: option,
            title: notice[0],
            content: notice.join('<br>'),
            template: 'markdown',
          }),
        })
      }
    } catch (error) {
      throw error
    }
  }
}

const main = async () => {
  const result = await glados()
  for (const line of result.notice) {
    console.log(line)
  }
  await notify(result.notice)
  if (result.failed) process.exitCode = 1
}

main().catch((error) => {
  console.error('Checkin Error')
  console.error(safeText(error?.message))
  process.exitCode = 1
})
