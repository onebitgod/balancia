package utils

import "net/http"

// GetAttemptsFromContext returns the attempts for request
func GetAttemptsFromContext(r *http.Request, Attempts any) int {
	if attempts, ok := r.Context().Value(Attempts).(int); ok {
		return attempts
	}
	return 1
}

// GetRetryFromContext returns the retries for request
func GetRetryFromContext(r *http.Request, Retry any) int {
	if retry, ok := r.Context().Value(Retry).(int); ok {
		return retry
	}
	return 0
}
