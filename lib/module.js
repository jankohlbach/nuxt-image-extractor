const fs = require('fs')
const { URL } = require('url')
const { join } = require('path')
const consola = require('consola')

const defaults = {
  // cms url
  baseUrl: '',
  // dir where downloaded images will be stored
  path: '/assets',
  extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'svg', 'gif']
}

module.exports = function Extract (moduleOptions) {
  const options = { ...defaults, ...moduleOptions }
  const baseDir = join(this.options.generate.dir, options.path)
  const routerBase = this.options.router.base !== '/' ? this.options.router.base : ''

  this.nuxt.hook('generate:distCopied', () => {
    if (!fs.existsSync(baseDir)) { fs.mkdirSync(baseDir) }
  })

  this.nuxt.hook('generate:page', async (page) => {
    return await process(page)
  })

  this.nuxt.hook('generate:routeCreated', async ({ route }) => {
    const routePath = join(this.options.generate.dir, this.options.generate.staticAssets.versionBase, route)
    const payloadPath = join(routePath, 'payload.js')
    return await rewritePayload(payloadPath)
  })

  async function process (page) {
    const urls = []
    const test = new RegExp(`(http(s?):)([/|.|\\w|\\s|-]|%|:|~)*.(?:${options.extensions.join('|')}){1}[^"|\\s]*`, 'g')
    const matches = page.html.matchAll(test)

    for (const match of matches) {
      const url = new URL(match[0])

      if (!urls.find(u => u.href === url.href) && !match[0].includes('http://www.w3.org/')) {
        urls.push(url)
      }
    }

    if (!urls.length) { return }

    consola.info(`${page.route}: nuxt-image-extractor is replacing ${urls.length} images with local copies`)

    return await replaceRemoteImages(page.html, urls).then(html => (page.html = html))
  }

  async function replaceRemoteImages (html, urls) {
    await Promise.all(
      urls.map(async (url) => {
        const ext = '.' + (url.pathname + url.hash).split('.').pop()
        const nameWithSearchParams =
          slugify((url.pathname + url.hash).split(ext).join('')) +
          (url.search
            ? '-searchParams' + slugify(url.search)
            : '') +
          ext
        const imgPath = join(baseDir, nameWithSearchParams)

        return await saveRemoteImage(url.href, imgPath)
          .then(() => {
            html = html.split(`"${url.href}"`).join(`"${options.path}/${nameWithSearchParams}"`)
          })
          .catch(e => consola.error(e))
      })
    )

    return html
  }

  function rewritePayload (payloadPath) {
    const urls = []
    const test = new RegExp(`(http(s?):)([\\\\u002F|.|\\w|\\s|-]|%|:|~|\\\\u002F)*.(?:'${options.extensions.join('|')}){1}[^"|\\s]*`, 'g')

    fs.readFile(payloadPath, 'utf8', async (err, data) => {
      if (err) { return consola.error(err) }

      const matches = data.matchAll(test)

      for (const match of matches) {
        const url = new URL(decodeURIComponent(JSON.parse(`"${removeTrailingBackslash(match[0])}"`)))

        if (!urls.find(u => u.href === url.href) && !match[0].includes('http://www.w3.org/')) {
          urls.push(url)
        }
      }

      if (!urls.length) { return }

      await replacePayloadImageLinks(data, urls)
        .then((payload) => {
          fs.writeFile(payloadPath, payload, 'utf8', (err) => {
            if (err) { return consola.error(err) }
          })
        })
    })
  }

  async function replacePayloadImageLinks (payload, urls) {
    let count = 0

    await Promise.all(
      urls.map((url) => {
        const ext = '.' + (url.pathname + url.hash).split('.').pop()
        const preName = (url.pathname + url.hash).split(ext).join('')
        const name = slugify(encodeChars(preName)) + ext.split('?')[0]

        let remoteLink = url.href.split('.')
        remoteLink.pop()
        remoteLink = encodeSlashes(encodeChars(remoteLink.join('.'))) + ext

        payload = payload.split(remoteLink).join(encodeSlashes(encodeChars(routerBase + options.path + '/')) + name)
        count++

        return null
      })
    )

    consola.info(`nuxt-image-extractor replaced ${count} image links in this payload`)

    return payload
  }
}

async function saveRemoteImage (url, path) {
  const res = await fetch(url)

  if (!res.ok) {
    consola.error(`Failed to fetch: ${url} - Status: ${res.status}`)
    process.exit(1)
  }

  const fileStream = fs.createWriteStream(path)
  return await new Promise((resolve, reject) => {
    res.body.pipe(fileStream)
    res.body.on('error', (err) => {
      reject(err)
    })
    fileStream.on('finish', () => {
      resolve()
    })
  })
}

// https://gist.github.com/codeguy/6684588
function slugify (text) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .trim()
    .replace('/', '')
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '-')
    .replace(/--+/g, '-')
}

function removeTrailingBackslash (str) {
  return str.replace(/\\+$/, '')
}

function encodeChars (str) {
  return (
    str
      .replace(/%/g, '%25') // Needs to be first in the chain
      // .replace(/`/g, '%60') this char ` is converted when URL is created
      .replace(/!/g, '%21')
      .replace(/@/g, '%40')
      .replace(/\^/g, '%5E')
      .replace(/#/g, '%23')
      .replace(/\$/g, '%24')
      .replace(/&/g, '%26')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29')
      .replace(/=/g, '%3D')
      .replace(/\+/g, '%2B')
      .replace(/,/g, '%2C')
      .replace(/;/g, '%3B')
      .replace(/'/g, '%27')
      .replace(/\[/g, '%5B')
      .replace(/{/g, '%7B')
      .replace(/]/g, '%5D')
      .replace(/}/g, '%7D')
  )
}

function encodeSlashes (str) {
  return str.replace(/\//g, '\\u002F')
}

module.exports.meta = require('../package.json')
