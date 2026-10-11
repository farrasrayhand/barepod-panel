package api

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"

	"github.com/farrasrayhand/barepod-panel/backend/internal/dbengine"
	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// mongoAdmin connects to a containerised MongoDB as the administrator the panel
// created, over loopback. There is no client binary and no password in an argument
// list — the credential lives only in the connection string, in memory.
func (s *Server) mongoAdmin(ctx context.Context, engine dbengine.Engine) (*mongo.Client, error) {
	if engine.Mode != dbengine.ModeDocker {
		return nil, errors.New("this MongoDB is not run by the panel as a container")
	}
	if _, err := s.ensureEngineRunning(ctx, engine); err != nil {
		return nil, err
	}
	credential, err := s.engineCredentialFor(ctx, engine)
	if err != nil {
		return nil, err
	}
	password, err := secrets.Decrypt(s.key, credential.Ciphertext)
	if err != nil {
		return nil, errors.New("the engine administrator credential could not be decrypted")
	}
	uri := fmt.Sprintf("mongodb://%s:%s@%s:%d/?authSource=admin",
		url.QueryEscape(credential.AdminUser), url.QueryEscape(password), credential.Host, credential.Port)

	connectCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	client, err := mongo.Connect(options.Client().
		ApplyURI(uri).
		SetConnectTimeout(5 * time.Second).
		SetServerSelectionTimeout(5 * time.Second))
	if err != nil {
		return nil, err
	}
	if err := client.Ping(connectCtx, readpref.Primary()); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, fmt.Errorf("the MongoDB administrator could not connect: %w", err)
	}
	return client, nil
}

// mongoAccess is the role a database's own user is given on its own database.
func mongoAccess(record *store.Database) bson.A {
	return bson.A{bson.D{{Key: "role", Value: "readWrite"}, {Key: "db", Value: record.Name}}}
}

// provisionMongo creates the database's own user inside the running container, so
// a MongoDB record becomes ready instead of "provisioning is manual".
func (s *Server) provisionMongo(ctx context.Context, user *store.User, record *store.Database, password string, engine dbengine.Engine) error {
	client, err := s.mongoAdmin(ctx, engine)
	if err != nil {
		record.Status = "failed"
		record.Note = err.Error()
		return nil
	}
	defer func() { _ = client.Disconnect(context.Background()) }()

	command := bson.D{
		{Key: "createUser", Value: record.User},
		{Key: "pwd", Value: password},
		{Key: "roles", Value: mongoAccess(record)},
	}
	if err := client.Database(record.Name).RunCommand(ctx, command).Err(); err != nil {
		record.Status = "failed"
		record.Note = fmt.Sprintf("MongoDB refused to create the user: %s", err)
		return nil
	}
	record.Status = "ready"
	_ = s.store.Audit(user.ID, "database.provision", record.Name, "", fmt.Sprintf("mongodb %s", record.Version))
	return nil
}

// rotateMongo replaces the database user's password. It is also the action the
// panel's own note points at to finish a record that was never created ("rotate
// the password to finish"), so a user that does not exist yet is created rather
// than refused — otherwise an older MongoDB record could never become usable.
func (s *Server) rotateMongo(ctx context.Context, record *store.Database, password string, engine dbengine.Engine) error {
	client, err := s.mongoAdmin(ctx, engine)
	if err != nil {
		return err
	}
	defer func() { _ = client.Disconnect(context.Background()) }()

	db := client.Database(record.Name)
	err = db.RunCommand(ctx, bson.D{{Key: "updateUser", Value: record.User}, {Key: "pwd", Value: password}}).Err()
	if err != nil && strings.Contains(err.Error(), "UserNotFound") {
		create := bson.D{
			{Key: "createUser", Value: record.User},
			{Key: "pwd", Value: password},
			{Key: "roles", Value: mongoAccess(record)},
		}
		return db.RunCommand(ctx, create).Err()
	}
	return err
}

// suspendMongo removes the database's user. MongoDB has no disabled account (a
// user with no roles still authenticates), so the honest "refuse new connections"
// is to drop it; the data is untouched, and restore recreates it from the vaulted
// credential.
func (s *Server) suspendMongo(ctx context.Context, record *store.Database, engine dbengine.Engine) error {
	client, err := s.mongoAdmin(ctx, engine)
	if err != nil {
		return err
	}
	defer func() { _ = client.Disconnect(context.Background()) }()

	err = client.Database(record.Name).RunCommand(ctx, bson.D{{Key: "dropUser", Value: record.User}}).Err()
	if err != nil && strings.Contains(err.Error(), "UserNotFound") {
		return nil // already gone
	}
	return err
}

// restoreMongo puts the user back, with the credential the vault holds, so a
// restored database connects with exactly the password the panel shows.
func (s *Server) restoreMongo(ctx context.Context, record *store.Database, password string, engine dbengine.Engine) error {
	client, err := s.mongoAdmin(ctx, engine)
	if err != nil {
		return err
	}
	defer func() { _ = client.Disconnect(context.Background()) }()

	command := bson.D{
		{Key: "createUser", Value: record.User},
		{Key: "pwd", Value: password},
		{Key: "roles", Value: mongoAccess(record)},
	}
	err = client.Database(record.Name).RunCommand(ctx, command).Err()
	if err != nil && strings.Contains(err.Error(), "already exists") {
		return nil
	}
	return err
}

// purgeMongo drops the user and the database — the only destructive step.
func (s *Server) purgeMongo(ctx context.Context, record *store.Database, engine dbengine.Engine) error {
	client, err := s.mongoAdmin(ctx, engine)
	if err != nil {
		return err
	}
	defer func() { _ = client.Disconnect(context.Background()) }()

	// The user may already be gone; the database is what matters.
	_ = client.Database(record.Name).RunCommand(ctx, bson.D{{Key: "dropUser", Value: record.User}}).Err()
	return client.Database(record.Name).Drop(ctx)
}
