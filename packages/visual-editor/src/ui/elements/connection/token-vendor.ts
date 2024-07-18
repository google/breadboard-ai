/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext } from "@lit/context";
import { type Environment } from "../../contexts/environment.js";
import { SETTINGS_TYPE, type SettingsHelper } from "../../types/types.js";
import {
  type RefreshRequest,
  type RefreshResponse,
  type TokenGrant,
} from "./connection-common.js";

export const tokenVendorContext = createContext<TokenVendor>("TokenVendor");

export type TokenResult =
  | ValidTokenResult
  | ExpiredTokenResult
  | SignedOutTokenResult;

/**
 * The token is valid and ready to be used.
 */
export interface ValidTokenResult {
  state: "valid";
  grant: TokenGrant;
  expired?: never;
  refresh?: never;
}

/**
 * The user is signed-in to this service, but the token we have is expired. Call
 * the `refresh` method to automatically refresh it.
 */
export interface ExpiredTokenResult {
  state: "expired";
  grant?: never;
  expired?: never;
  refresh: (opts?: { signal?: AbortSignal }) => Promise<ValidTokenResult>;
}

/**
 * The user is not signed-in to this service. In this case, typically a
 * `<bb-connection-signin>` element should be displayed to prompt the user to
 * sign-in.
 */
export interface SignedOutTokenResult {
  state: "signedout";
  grant?: never;
  expired?: never;
  refresh?: never;
}

/**
 * If a token is going to expire in less than this many milliseconds, we treat
 * it as though it is already expired, since there might be a delay between
 * returning it from here and it actually getting used.
 */
const EXPIRY_THRESHOLD_MS = /* 1 minute */ 60_000;

/**
 * Provides access to authorization tokens stored in settings, and the ability
 * to refresh them if they are expired.
 *
 * There should typically be one instance of this class per Visual Editor, and
 * elements should discover it using the {@link tokenVendorContext} Lit
 * context, which should be provided by the top-level Visual Editor element.
 */
export class TokenVendor {
  #settings: SettingsHelper;
  #environment: Environment;

  constructor(settings: SettingsHelper, environment: Environment) {
    this.#settings = settings;
    this.#environment = environment;
  }

  getToken(connectionId: string): TokenResult {
    const grantJsonText = this.#settings.get(
      SETTINGS_TYPE.CONNECTIONS,
      connectionId
    );
    if (grantJsonText === undefined) {
      return { state: "signedout" };
    }
    const grant = JSON.parse(String(grantJsonText.value)) as TokenGrant;
    if (grantIsExpired(grant)) {
      return {
        state: "expired",
        refresh: (opts?: { signal?: AbortSignal }) =>
          this.#refresh(connectionId, grant.refresh_token, opts?.signal),
      };
    }
    return { state: "valid", grant };
  }

  async #refresh(
    connectionId: string,
    refreshToken: string,
    signal?: AbortSignal
  ): Promise<ValidTokenResult> {
    const refreshUrl = new URL(
      "refresh",
      this.#environment.connectionServerUrl
    );
    refreshUrl.search = new URLSearchParams({
      connection_id: connectionId,
      refresh_token: refreshToken,
    } satisfies RefreshRequest).toString();

    const now = Date.now();
    const httpRes = await fetch(refreshUrl, {
      signal,
      credentials: "include",
    });
    if (!httpRes.ok) {
      throw new Error(String(httpRes.status));
    }
    const jsonRes = (await httpRes.json()) as RefreshResponse;
    if (jsonRes.error !== undefined) {
      throw new Error(jsonRes.error);
    }

    const updatedGrant: TokenGrant = {
      access_token: jsonRes.access_token,
      expires_in: jsonRes.expires_in,
      issue_time: now,
      refresh_token: refreshToken,
    };
    await this.#settings.set(SETTINGS_TYPE.CONNECTIONS, connectionId, {
      name: connectionId,
      value: JSON.stringify(updatedGrant),
    });
    return { state: "valid", grant: updatedGrant };
  }
}

function grantIsExpired(grant: TokenGrant): boolean {
  const expiresAt =
    /* absolute milliseconds */ grant.issue_time +
    /* relative seconds */ grant.expires_in * 1000;
  const expiresIn = expiresAt - /* unix milliseconds */ Date.now();
  return expiresIn <= EXPIRY_THRESHOLD_MS;
}
