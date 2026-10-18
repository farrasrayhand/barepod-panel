package notify

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

// smtpChannel delivers email. It uses STARTTLS on the submission port, which is what every mail
// provider the panel names in its README expects.
type smtpChannel struct {
	host     string
	port     int
	user     string
	password string
	from     string
	to       string
}

func (smtpChannel) Name() string { return "smtp" }

func (c smtpChannel) Send(ctx context.Context, m Message) error {
	port := c.port
	if port == 0 {
		port = 587
	}
	from := c.from
	if from == "" {
		from = c.user
	}
	if from == "" {
		return fmt.Errorf("smtp: no from address configured")
	}

	dialer := &net.Dialer{Timeout: 10 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(c.host, strconv.Itoa(port)))
	if err != nil {
		return err
	}
	client, err := smtp.NewClient(conn, c.host)
	if err != nil {
		conn.Close()
		return err
	}
	defer client.Close()

	if ok, _ := client.Extension("STARTTLS"); ok {
		if err := client.StartTLS(&tls.Config{ServerName: c.host}); err != nil {
			return err
		}
	}
	if c.user != "" {
		if ok, _ := client.Extension("AUTH"); ok {
			if err := client.Auth(smtp.PlainAuth("", c.user, c.password, c.host)); err != nil {
				return err
			}
		}
	}
	if err := client.Mail(from); err != nil {
		return err
	}
	if err := client.Rcpt(c.to); err != nil {
		return err
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write([]byte(c.message(from, m))); err != nil {
		return err
	}
	return w.Close()
}

func (c smtpChannel) message(from string, m Message) string {
	subject := strings.TrimSpace(m.Title)
	if subject == "" {
		subject = "BarePod Panel alert"
	}
	// A header injection through the subject would let a job's output rewrite the message.
	subject = strings.NewReplacer("\r", " ", "\n", " ").Replace(subject)

	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\n", from)
	fmt.Fprintf(&b, "To: %s\r\n", c.to)
	fmt.Fprintf(&b, "Subject: %s\r\n", subject)
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=\"utf-8\"\r\n")
	b.WriteString("\r\n")
	b.WriteString(strings.ReplaceAll(m.Body, "\n", "\r\n"))
	b.WriteString("\r\n")
	return b.String()
}
