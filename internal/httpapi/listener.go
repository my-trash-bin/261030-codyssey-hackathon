package httpapi

import (
	"errors"
	"net"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var hostnamePattern = regexp.MustCompile(`^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$`)

// ListenerHosts separates bind addresses from browser Host authorities.
func ListenerHosts(listen string, additional []string) ([]string, error) {
	addresses, err := net.InterfaceAddrs()
	if err != nil {
		return nil, errors.New("server.listen: 네트워크 인터페이스를 확인할 수 없습니다")
	}
	ips := []net.IP{}
	for _, address := range addresses {
		if ip, _, err := net.ParseCIDR(address.String()); err == nil {
			ips = append(ips, ip)
		}
	}
	return listenerHosts(listen, additional, ips)
}

func listenerHosts(listen string, additional []string, ips []net.IP) ([]string, error) {
	host, port, err := net.SplitHostPort(listen)
	if err != nil || net.ParseIP(host) == nil || !validPort(port) {
		return nil, errors.New("server.listen: IP:port 형식으로 지정하세요; 예: 0.0.0.0:8080")
	}
	ip := net.ParseIP(host)
	allowed := map[string]bool{}
	add := func(host string) { allowed[strings.ToLower(net.JoinHostPort(host, port))] = true }
	if ip.IsUnspecified() {
		add("127.0.0.1")
		add("localhost")
		for _, address := range ips {
			if !address.IsUnspecified() && (ip.To4() == nil || address.To4() != nil) {
				add(address.String())
			}
		}
	} else {
		add(ip.String())
		if ip.IsLoopback() {
			add("localhost")
		}
	}
	for _, authority := range additional {
		name, p, err := net.SplitHostPort(authority)
		parsed := net.ParseIP(name)
		if err != nil || !validPort(p) || (parsed == nil && !hostnamePattern.MatchString(name)) || (parsed != nil && parsed.IsUnspecified()) {
			return nil, errors.New("server.allowed_hosts: 호스트:포트 목록을 지정하세요; URL·와일드카드는 사용할 수 없습니다")
		}
		allowed[strings.ToLower(authority)] = true
	}
	result := make([]string, 0, len(allowed))
	for name := range allowed {
		result = append(result, name)
	}
	sort.Strings(result)
	return result, nil
}

func validPort(port string) bool {
	n, err := strconv.Atoi(port)
	return err == nil && n > 0 && n <= 65535
}
