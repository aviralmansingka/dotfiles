package main

func cmdRepo(a args, s *Store) (any, error) {
	switch a.at(1) {
	case "add":
		if !a.has("checkout") {
			return nil, problem("usage", "repo add requires --checkout")
		}
		return s.addRepo(a.at(2), a.get("checkout"), a.get("remote"))
	case "list":
		return s.repos()
	}
	return nil, problem("usage", "use repo add or repo list")
}
