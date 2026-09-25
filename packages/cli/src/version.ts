/** The version every report names as its tool. A test keeps it equal to `package.json`. */
export const VERSION = '0.0.0'

/** Sent on every request that does not name its own, as some platforms refuse one without. */
export const USER_AGENT = `verifai/${VERSION}`
