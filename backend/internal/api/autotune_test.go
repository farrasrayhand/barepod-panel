package api

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestAutoTuneAPI_GetAndApply(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	// 1. GET /api/v1/system/autotune
	resp, body := panel.do(t, http.MethodGet, "/api/v1/system/autotune", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK from GET /system/autotune, got %d: %s", resp.StatusCode, body)
	}

	var getResp struct {
		Profile struct {
			HostRAMMB int `json:"hostRamMb"`
			MariaDB   struct {
				BufferPoolSizeMB int `json:"bufferPoolSizeMb"`
			} `json:"mariadb"`
			PostgreSQL struct {
				SharedBuffersMB int `json:"sharedBuffersMb"`
			} `json:"postgresql"`
			Redis struct {
				MaxMemoryMB int `json:"maxMemoryMb"`
			} `json:"redis"`
		} `json:"profile"`
		RAMMB int `json:"ramMb"`
	}
	if err := json.Unmarshal(body, &getResp); err != nil {
		t.Fatalf("failed to decode get response: %v", err)
	}

	if getResp.Profile.MariaDB.BufferPoolSizeMB <= 0 {
		t.Errorf("expected positive MariaDB buffer pool size, got %d", getResp.Profile.MariaDB.BufferPoolSizeMB)
	}
	if getResp.Profile.PostgreSQL.SharedBuffersMB <= 0 {
		t.Errorf("expected positive PostgreSQL shared buffers, got %d", getResp.Profile.PostgreSQL.SharedBuffersMB)
	}
	if getResp.Profile.Redis.MaxMemoryMB <= 0 {
		t.Errorf("expected positive Redis max memory, got %d", getResp.Profile.Redis.MaxMemoryMB)
	}

	// 2. POST /api/v1/system/autotune (requires admin capability)
	applyResp, applyBody := panel.do(t, http.MethodPost, "/api/v1/system/autotune", nil)
	if applyResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK from POST /system/autotune, got %d: %s", applyResp.StatusCode, applyBody)
	}

	var applyResult struct {
		Success bool `json:"success"`
		Result  struct {
			MariaDBStatus  string `json:"mariadbStatus"`
			PostgresStatus string `json:"postgresStatus"`
			RedisStatus    string `json:"redisStatus"`
		} `json:"result"`
	}
	if err := json.Unmarshal(applyBody, &applyResult); err != nil {
		t.Fatalf("failed to decode apply response: %v", err)
	}

	if !applyResult.Success {
		t.Error("expected applyResult.Success to be true")
	}
}
