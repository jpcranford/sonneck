// Package oidcauth wraps the OAuth2/OIDC authorization-code exchange for
// multi-user support's OIDC mode (master plan Phase 14,
// precious-kindling-pretzel.md). Kept separate from internal/config
// (which stays a pure env-var parse-and-validate package, no network I/O)
// because constructing an Authenticator does one real network call —
// OIDC discovery, GET {issuer}/.well-known/openid-configuration — so it's
// its own startup step in cmd/sonneck/main.go, called only when
// cfg.AuthMethod == "oidc".
//
// go-oidc (RP-only, never the IdP/server side — the only role this app
// ever needs) + golang.org/x/oauth2, both pure Go: memory
// project_oidc_multiuser_plan.md's own library research.
package oidcauth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/jpcranford/sonneck/internal/config"
)

// Authenticator holds one process-lifetime OIDC client, built once at
// startup from the discovery document.
type Authenticator struct {
	oauth2Config *oauth2.Config
	verifier     *oidc.IDTokenVerifier
}

// New performs OIDC discovery against cfg.OIDCIssuerURL and returns a ready
// Authenticator, or an error if discovery fails — the caller (main.go)
// treats that as a fail-fast startup error, same as any other
// required-when-applicable config value, just one step later since this
// specific check needs a live network call the rest of config.Load()
// deliberately never makes.
func New(ctx context.Context, cfg *config.Config) (*Authenticator, error) {
	provider, err := oidc.NewProvider(ctx, cfg.OIDCIssuerURL)
	if err != nil {
		return nil, fmt.Errorf("OIDC discovery against %s: %w", cfg.OIDCIssuerURL, err)
	}
	return &Authenticator{
		oauth2Config: &oauth2.Config{
			ClientID:     cfg.OIDCClientID,
			ClientSecret: cfg.OIDCClientSecret,
			RedirectURL:  cfg.OIDCRedirectURI,
			Endpoint:     provider.Endpoint(),
			Scopes:       []string{oidc.ScopeOpenID, oidc.ScopeProfile, oidc.ScopeEmail},
		},
		verifier: provider.Verifier(&oidc.Config{ClientID: cfg.OIDCClientID}),
	}, nil
}

// NewState generates a random, URL-safe CSRF state token — the same
// crypto/rand shape internal/auth.NewSessionToken already uses, kept as a
// separate copy here rather than importing internal/auth for one function,
// since a state token and a session token are conceptually different
// things that just happen to share a generation shape.
func NewState() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// AuthCodeURL is the redirect target for GET /api/auth/oidc/login. No
// separate nonce — state alone is the standard CSRF defense for a
// server-side auth-code flow with no JS-side ID-token handling, consistent
// with this app's already-stated non-adversarial threat model
// (internal/auth's own comment on session TTL: "household/small group...
// not a security-sensitive multi-tenant deployment").
func (a *Authenticator) AuthCodeURL(state string) string {
	return a.oauth2Config.AuthCodeURL(state)
}

// Claims is the subset of standard OIDC claims this app actually uses —
// sub for identity, name/picture for display (master plan's Phase 4
// forward note: re-fetch/update the avatar on every login, not just the
// first).
type Claims struct {
	Subject string
	Name    string
	Picture string
}

// Exchange trades an authorization code for tokens, verifies the ID
// token's signature/issuer/audience/expiry, and extracts the claims this
// app uses. Name falls back to a generic label when the IdP doesn't supply
// one — every account needs a non-empty display_name (same requirement
// none/singlepass's seeded "Admin" row already satisfies).
func (a *Authenticator) Exchange(ctx context.Context, code string) (Claims, error) {
	token, err := a.oauth2Config.Exchange(ctx, code)
	if err != nil {
		return Claims{}, fmt.Errorf("token exchange: %w", err)
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		return Claims{}, fmt.Errorf("token response carried no id_token")
	}
	idToken, err := a.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return Claims{}, fmt.Errorf("verifying id_token: %w", err)
	}

	var raw struct {
		Name    string `json:"name"`
		Picture string `json:"picture"`
	}
	if err := idToken.Claims(&raw); err != nil {
		return Claims{}, fmt.Errorf("parsing id_token claims: %w", err)
	}
	name := raw.Name
	if name == "" {
		name = "OIDC User"
	}
	return Claims{Subject: idToken.Subject, Name: name, Picture: raw.Picture}, nil
}
