// NOTE: This is where you could wire up your own data providers:
import { getProducts as _getProducts, getUsers as _getUsers } from '../services/index.js';
import { API_URL, REMOTE_ASSETS_BASE_URL } from '../app/constants.js';
import type { Endpoint, EndpointsToOperations } from '../types/entities.js';

export async function fetchData<Selected extends Endpoint>(endpoint: Selected) {
	const apiEndpoint = `${API_URL}${endpoint}`;
	console.info(`Fetching ${apiEndpoint}…`);
	try {
		const res = await fetch(apiEndpoint);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return (await res.json()) as unknown as ReturnType<EndpointsToOperations[Selected]>;
	} catch (e) {
		console.warn(`fetchData fallback for ${endpoint}:`, e);
		const map: Record<string, () => unknown> = { products: _getProducts, users: _getUsers };
		const op = map[endpoint];
		if (!op) throw e;
		return op() as ReturnType<EndpointsToOperations[Selected]>;
	}
}

export function url(path = '') {
	return `${import.meta.env.SITE}${import.meta.env.BASE_URL}${path}`;
}

export function asset(path: string) {
	return `${REMOTE_ASSETS_BASE_URL}/${path}`;
}
