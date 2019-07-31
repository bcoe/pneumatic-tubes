const axios = require('axios')
const ChangesStream = require('changes-stream')
const eos = require('end-of-stream')
const exec = require('child_process').exec
const fs = require('fs')
const gunzip = require('gunzip-maybe')
const tar = require('tar-stream')
const mkdirp = require('mkdirp')
const path = require('path')
const { ReadableStreamBuffer, WritableStreamBuffer } = require('stream-buffers')
const uuid = require('uuid/v4')
const yargs = require('yargs')
const zlib = require('zlib')

const defaultSourceCouchdb = 'http://localhost:15984/registry'
const defaultTargetRegistry = 'http://localhost:18080'
const defaultLastSequence = 0
const defaultHaltOnError = false
const defaultTmpFolder = '/tmp/tarballs'
const defaultRemovePublishRegistry = false

const args = yargs
  .env('PNEUMATIC_TUBES')
  .option('source-couchdb', {
    type: 'string',
    desc: 'the CouchDB from which to stream changes',
    default: defaultSourceCouchdb
  })
  .option('target-registry', {
    type: 'string',
    desc: 'the registry to populate',
    default: defaultTargetRegistry
  })
  .option('last-sequence', {
    type: 'number',
    desc: 'the source sequence',
    default: defaultLastSequence
  })
  .option('halt-on-error', {
    type: 'boolean',
    desc: 'halt when an error occurs',
    default: defaultHaltOnError
  })
  .option('--remove-publish-registry', {
    type: 'boolean',
    desc: 'if .publishConfig.registry exists in package.json, remove it rather than replacing it with the target-registry',
    default: defaultRemovePublishRegistry
  })
  .option('tmp-folder', {
    type: 'string',
    desc: 'scratch directory for package tarballs',
    default: defaultTmpFolder
  })
  .argv

class Tubes {
  constructor (opts) {
    this.sourceCouchdb = opts.sourceCouchdb || defaultSourceCouchdb
    this.targetRegistry = opts.targetRegistry || defaultTargetRegistry
    this.lastSequence = opts.lastSequence || defaultLastSequence
    this.haltOnError = opts.haltOnError || defaultHaltOnError
    this.tmpFolder = opts.tmpFolder || defaultTmpFolder
    this.removePublishRegistry = opts.removePublishRegistry || defaultRemovePublishRegistry

    mkdirp.sync(this.tmpFolder)
  }

  series () {
    const changes = new ChangesStream({
      db: this.sourceCouchdb, // full database URL
      include_docs: true, // whether or not we want to return the full document as a property,
      since: this.lastSequence
    })
    changes.on('readable', async () => {
      const change = changes.read()
      console.info(`processing sequence ${change.seq}`)
      if (change.doc && change.doc.versions) {
        changes.pause()
        try {
          await this.processChange(change)
        } catch (err) {
          console.warn(err)
        }
        changes.resume()
      }
    })
  }

  async processChange (change) {
    const versions = Object.keys(change.doc.versions)
    for (var i = 0, version; (version = change.doc.versions[versions[i]]) !== undefined; i++) {
      if (version.dist && version.dist.tarball) {
        try {
          const tarball = version.dist.tarball
          const filename = await this.download(tarball)
          await this.publish(filename)
        } catch (err) {
          if (this.haltOnError) {
            console.error(err.message)
            process.exit(err.code)
          } else {
            console.warn('Publish failed:', err.message)
          }
        }
      }
    }
  }

  download (tarball) {
    const filename = path.resolve(this.tmpFolder, `${uuid()}.tgz`)
    return axios({
      method: 'get',
      url: tarball,
      responseType: 'stream'
    })
      .then(function (response) {
        return new Promise((resolve, reject) => {
          const stream = response.data.pipe(fs.createWriteStream(filename))
          eos(stream, err => {
            if (err) return reject(err)
            else return resolve()
          })
        })
      })
      .then(() => {
        console.info(`finished writing ${filename}`)
        return filename
      })
  }

  correctPublishRegistry (tarball) {
    // Correct the .publishConfig.registry property if it is defined

    return new Promise((resolve, reject) => {
      let correctedPublishRegistry = false
      const gzip = () => zlib.createGzip()
      const newTarball = path.resolve(this.tmpFolder, `${uuid()}.tgz`)
      const srcStream = fs.createReadStream(tarball)
      const dstStream = fs.createWriteStream(newTarball)

      // Check whether the property is defined in the tarball
      const done = error => {
        if (error) {
          reject(error)
        } else {
          pack.finalize()
          resolve(correctedPublishRegistry ? newTarball : tarball)
        }
      }

      const extract = tar.extract()
      const pack = tar.pack()

      extract.on('entry', (header, stream, callback) => {
        if (header.name === 'package.json') {
          const inBuffer = new WritableStreamBuffer()
          const outBuffer = new ReadableStreamBuffer()

          stream
            .pipe(inBuffer)
            .on('end', () => {
              const pkg = JSON.parse(inBuffer.getContentsAsString('utf8'))
              if (pkg.publishConfig.registry == null) {
                outBuffer.put(inBuffer.getContents())
              } else {
                correctedPublishRegistry = true
                if (this.removePublishRegistry) {
                  delete pkg.publishConfig.registry
                  if (Object.keys(pkg.publishConfig).length < 1) {
                    delete pkg.publishConfig
                  }
                } else {
                  pkg.publishConfig.registry = this.targetRegistry
                }
                outBuffer.put(Buffer.from(JSON.stringify(pkg)))
              }
              outBuffer.pipe(pack.entry(header, callback))
            })
        } else {
          // Forward the entry into the new tarball unmodified.
          stream.pipe(pack.entry(header, callback))
        }
      })

      extract.on('finish', () => {
        done()
      })

      srcStream.pipe(gunzip()).pipe(extract)
      pack.pipe(gzip()).pipe(dstStream)
    })
  }

  publish (filename) {
    return new Promise((resolve, reject) => {
      exec(`npm --registry=${this.targetRegistry} publish ${filename}`, {
        cwd: this.tmpFolder,
        env: process.env
      }, (err, stdout, stderr) => {
        err.stderr = stderr
        if (err) return reject(err)
        else {
          console.info(`published ${stdout.trim()}`)
          return resolve()
        }
      })
    })
  }
}

module.exports = function (opts) {
  return new Tubes(opts)
}

const tubes = module.exports(args)
tubes.series()
