import { vi } from 'vitest'

import type { Account } from 'cloudflare/resources/accounts/accounts.mjs'

/**
 * Creates a mocked implementation of the Cloudflare client
 */
export const cloudflareClientMockImplementation = () => {
	return {
		accounts: {
			list: vi.fn(async () => {
				return {
					success: true,
					result: [
						{
							id: 'mock-account-id',
							name: 'mock-account-name',
						},
					] satisfies Account[],
				}
			}),
		},
	}
}
