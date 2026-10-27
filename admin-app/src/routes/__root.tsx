import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "minimum-scale=1, initial-scale=1, width=device-width",
			},
			{ title: "DOJO // MAINTENANCE TOOL" },
		],
		links: [
			{ rel: "icon", href: "/admin/icons/dojo.svg", type: "image/svg+xml" },
			{ rel: "stylesheet", href: "/admin/css/bootstrap.min.css" },
			{ rel: "stylesheet", href: "/admin/css/bootstrap-theme.min.css" },
			{ rel: "stylesheet", href: "/admin/css/style.css" },
		],
	}),
	component: () => (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<Outlet />
				<Scripts />
			</body>
		</html>
	),
});
