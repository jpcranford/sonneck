// Package api holds the pieces every HTTP handler shares: the {data}/{error}
// response envelope and the field validation used wherever a Piece or Book
// gets created or edited (CLAUDE.md > API response contract, > Testing).
package api

import (
	"encoding/json"
	"net/http"
)

// Error codes used across handlers. Keep this list small and reused rather
// than inventing a new code per endpoint.
const (
	CodeValidationError = "VALIDATION_ERROR"
	CodeNotFound        = "NOT_FOUND"
	CodeConflict        = "CONFLICT"
	CodeInternalError   = "INTERNAL_ERROR"
)

type successEnvelope struct {
	Data any `json:"data"`
}

type errorEnvelope struct {
	Error errorBody `json:"error"`
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// WriteData writes the {"data": ...} success envelope (CLAUDE.md > API
// response contract). Every successful handler response goes through this.
func WriteData(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(successEnvelope{Data: data})
}

// WriteError writes the {"error": {code, message}} envelope. Every failed
// handler response goes through this — no per-handler improvisation.
func WriteError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(errorEnvelope{Error: errorBody{Code: code, Message: message}})
}
