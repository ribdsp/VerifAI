/** What `--help` prints, for `verifai` and each of its commands. */

import { API_KEY_ENV } from './args.js'
import { EXIT_CODES } from './exit-codes.js'

const EXIT_CODE_LINES = `Exit codes:
  ${EXIT_CODES.pass}    pass      behaves like the advertised model, with enough evidence
  ${EXIT_CODES.caution}   caution   something is unresolved - not reassurance
  ${EXIT_CODES.fail}   fail      an adverse finding
  ${EXIT_CODES.usage}    usage     the command line or the input was wrong; nothing was probed
  ${EXIT_CODES.stopped}    stopped   the endpoint refused the key or model, or could not be reached
  ${EXIT_CODES.internal}    internal  VerifAI itself failed; nothing was concluded
  ${EXIT_CODES.cancelled}  cancelled Ctrl+C, or a declined confirmation`

export const MAIN_HELP = `VerifAI - check whether an API endpoint really serves the Claude or GPT model it claims.

Usage:
  verifai              choose between the terminal check and the web UI
  verifai check        check an endpoint from this terminal
  verifai web          open the local web UI in your browser

Options:
  -h, --help           show this help
  -v, --version        show the version

Run \`verifai <command> --help\` for a command's options.
`

export const CHECK_HELP = `Usage: verifai check [options]

On a terminal, anything left out is asked for. Without one, give --endpoint,
--model and --yes.

The API key is read from ${API_KEY_ENV}, or asked for with hidden input. It is
never taken as a flag, never written to disk, and redacted from every report.

Options:
  --endpoint <url>            the base URL you were given, such as https://gateway.example/v1
  --model <name>              the model you were sold, such as claude-opus-5-5
  --vendor <vendor>           auto (default), anthropic or openai
  --protocol <protocol>       auto (default), anthropic-messages, openai-chat or openai-responses
  --profile <profile>         quick, standard (default), deep or paranoid
  --auth <scheme>             how the key is sent: auto (default), x-api-key or bearer
                              (Snowflake Cortex takes bearer only)
  --max-requests <n>          stop planning past this many requests (1-2000)
  --max-tokens <n>            stop planning past this many tokens (0-2000000)
  --spread <duration>         spread the routing-dilution draws over, such as 90s or 10m (max 60m)
  --allow-private-targets     allow an endpoint on your own network, for this run only
  --show-endpoint             print the endpoint's address in the report, not only its hash
  --format <format>           terminal (default), markdown or json
  -o, --out <file>            write the report to a file instead of stdout
  -y, --yes                   run without asking to confirm the estimate
  -h, --help                  show this help

${EXIT_CODE_LINES}
`

export const WEB_HELP = `Usage: verifai web [options]

Serves the web UI on 127.0.0.1 and opens it in your browser. The link carries
a session token drawn for this process; only a page opened from that link can
use the local API, and a new \`verifai web\` prints a new one.

Options:
  --port <port>               listen on this port (default: a free one)
  --no-open                   print the link without opening a browser
  --allow-private-targets     let the page check endpoints on your own network
  -h, --help                  show this help

Press Ctrl+C to stop.
`
