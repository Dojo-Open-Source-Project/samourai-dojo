const accessKey = "access_token";
const refreshKey = "refresh_token";
const accessTimeKey = "access_token_ts";
const refreshTimeKey = "refresh_token_ts";

export function accessToken() {
	return sessionStorage.getItem(accessKey);
}
export function refreshToken() {
	return sessionStorage.getItem(refreshKey);
}
export function authenticated() {
	const token = accessToken();
	return Boolean(token && token !== "null");
}
export function adminToken(token: string) {
	try {
		return JSON.parse(atob(token.split(".")[1])).prf === "admin";
	} catch {
		return false;
	}
}
export function saveTokens(tokens: {
	access_token: string;
	refresh_token: string;
}) {
	sessionStorage.setItem(accessKey, tokens.access_token);
	sessionStorage.setItem(accessTimeKey, String(Date.now()));
	sessionStorage.setItem(refreshKey, tokens.refresh_token);
	sessionStorage.setItem(refreshTimeKey, String(Date.now()));
	sessionStorage.setItem("activeTab", "#link-status");
}
export function clearTokens() {
	for (const key of [
		accessKey,
		accessTimeKey,
		refreshKey,
		refreshTimeKey,
		"activeTab",
		"indexerType",
	])
		sessionStorage.removeItem(key);
}
export function refreshNeeded() {
	if (!authenticated()) return null;
	if (Date.now() - Number(sessionStorage.getItem(accessTimeKey) ?? 0) < 300_000)
		return null;
	return refreshToken();
}
export function saveAccessToken(token: string) {
	sessionStorage.setItem(accessKey, token);
	sessionStorage.setItem(accessTimeKey, String(Date.now()));
}
