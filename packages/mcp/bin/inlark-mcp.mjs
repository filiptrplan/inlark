#!/usr/bin/env node
// Bridges an MCP client's stdio to the MCP server running inside inlark. inlark must be open:
// it holds the decrypted credentials and the live connections, so this process only relays.
import { connect } from 'node:net'
import { defaultDataDirectory, socketPath } from './socket-path.mjs'

const path = process.env.INLARK_MCP_SOCKET || socketPath(defaultDataDirectory())
const socket = connect(path)
socket.on('connect', () => {
  process.stdin.pipe(socket)
  socket.pipe(process.stdout)
})
socket.on('error', (error) => {
  const missing = ['ENOENT', 'ECONNREFUSED'].includes(error.code)
  process.stderr.write(
    missing
      ? 'inlark is not running, or its MCP server is turned off. Open inlark and try again.\n'
      : 'Could not reach inlark at ' + path + ': ' + error.message + '\n',
  )
  process.exit(1)
})
socket.on('close', () => process.exit(0))
process.stdin.on('end', () => socket.end())
