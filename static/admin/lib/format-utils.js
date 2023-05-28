// eslint-disable-next-line no-unused-vars
const lib_fmt = {

    /*
     * Returns a stringified version of a cleaned json object
     */
    cleanJson: (json) => {
        let jsonText = JSON.stringify(json)
        jsonText = jsonText.replaceAll('\'', '"').replaceAll('False', 'false').replaceAll('True', 'true')
        jsonText = jsonText.replaceAll(/(Decimal\(")([\d,.E-]*)("\))/g, '"$2"')
        return jsonText
    },

    /*
     * Highlight syntax of json data
     */
    jsonSyntaxHighlight: (json) => {
        if (typeof json != 'string') {
            json = JSON.stringify(json, undefined, 2)
        }

        json = json.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

        return json.replaceAll(
            /("(\\u[\dA-Za-z]{4}|\\[^u]|[^"\\])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[Ee][+-]?\d+)?)/g,
            (match) => {
                let cls = 'number'
                if (match.startsWith('"')) {
                    cls = match.endsWith(':') ? 'key' : 'string'
                } else if (/true|false/.test(match)) {
                    cls = 'boolean'
                } else if (/null/.test(match)) {
                    cls = 'null'
                }
                return `<span class="${cls}">${  match  }</span>`
            }
        )
    },

    /*
     * Format a unix timestamp to locale date string
     */
    unixTsToLocaleString: (ts) => {
        let tmpDate = new Date(ts * 1000)
        return tmpDate.toLocaleString()
    },

    /*
     * Format a unix timestamp into a readable date/hour
     */
    formatUnixTs: (ts) => {
        if (ts == null || ts === 0)
            return '-'

        let tmpDate = new Date(ts * 1000),
            options = { hour: '2-digit', minute: '2-digit', hour12: false }
        return tmpDate.toLocaleDateString('fr-FR', options)
    }

}
