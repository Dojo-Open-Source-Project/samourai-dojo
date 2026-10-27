import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { adminToken, saveTokens } from "../auth";
import { errorMessage, NoticeProvider, Qr, useNotice } from "../ui";

export const Route = createFileRoute("/")({ component: LoginPage });
function LoginPage() {
	useEffect(() => {
		document.body.className = "home";
	}, []);
	return (
		<NoticeProvider>
			<Login />
		</NoticeProvider>
	);
}
function Login() {
	const navigate = useNavigate();
	const notice = useNotice();
	const [key, setKey] = useState("");
	const [avatarFailed, setAvatarFailed] = useState(false);
	const auth47 = useQuery({
		queryKey: ["auth47-uri"],
		queryFn: ({ signal }) => api.auth47Uri(signal),
		retry: false,
	});
	const nonce = auth47.data?.data.nonce;
	const status = useQuery({
		queryKey: ["auth47-status", nonce],
		queryFn: ({ signal }) => api.auth47Status(nonce ?? "", signal),
		enabled: Boolean(nonce),
		refetchInterval: (query) =>
			query.state.data?.authorizations ? false : 2000,
	});
	useEffect(() => {
		if (status.data?.authorizations) {
			saveTokens(status.data.authorizations);
			void navigate({ to: "/dmt/" });
		}
	}, [status.data, navigate]);
	const login = useMutation({
		mutationFn: api.login,
		onSuccess: (response) => {
			if (!adminToken(response.authorizations.access_token)) {
				notice.show("error", "You must sign in with the admin key");
				return;
			}
			saveTokens(response.authorizations);
			void navigate({ to: "/dmt/" });
		},
		onError: (error) => notice.show("error", errorMessage(error)),
	});
	function submit(event: FormEvent) {
		event.preventDefault();
		if (!key) {
			notice.show("error", "Admin key is mandatory");
			return;
		}
		notice.show("message", "Processing...");
		login.mutate(key);
	}
	const uri = auth47.data?.data.uri;
	const paymentCode = auth47.data?.data.paymentCode;
	return (
		<div id="login-page" className="container">
			<div id="welcome-msg" className="row">
				<div className="col-xs-12 login-brand">
					<div className="brand-tile">
						<img
							src="/admin/icons/dojo.svg"
							className="brand-tile-icon"
							alt=""
						/>
					</div>
					<h1 className="title">
						<span>DOJO {/* MAINTENANCE TOOL */}</span> <span className="beta" />
					</h1>
				</div>
			</div>
			<div id="inputs" className="row">
				<div className="col-xs-2" />
				<div className="col-xs-8 box-content signin-box">
					<form
						id="signin"
						className={`signin ${uri ? "with-auth47" : ""}`}
						onSubmit={submit}
					>
						<p className="signin-subtitle">
							Authenticate with your Dojo admin key.
						</p>
						<label htmlFor="apikey">ADMIN KEY</label>
						<input
							type="password"
							id="apikey"
							placeholder="ENTER YOUR ADMIN KEY"
							value={key}
							onChange={(e) => setKey(e.target.value)}
						/>
						<div className="box-actions">
							<button
								className="btn btn-success"
								type="submit"
								disabled={login.isPending}
							>
								CONNECT
							</button>
						</div>
					</form>
					<div id="qr-auth47" className={`auth47-box ${uri ? "active" : ""}`}>
						{uri && (
							<div className="auth47-qr" style={{ border: "10px solid #fff" }}>
								<Qr value={uri} />
								<div
									className="qr-logo"
									style={{
										backgroundImage:
											paymentCode && !avatarFailed
												? "none"
												: "url(/admin/icons/dojo.svg)",
									}}
								>
									{paymentCode && !avatarFailed && (
										<img
											src={`http://paynym25chftmsywv4v2r67agbrr62lcxagsf4tymbzpeeucucy2ivad.onion/${encodeURIComponent(paymentCode)}/avatar`}
											alt="PayNym Avatar"
											style={{
												width: "100%",
												height: "100%",
												objectFit: "cover",
											}}
											onError={() => setAvatarFailed(true)}
										/>
									)}
								</div>
							</div>
						)}
					</div>
				</div>
				<div className="col-xs-2" />
			</div>
			{status.isError && (
				<div role="alert" className="msg-error">
					{errorMessage(status.error)}
				</div>
			)}
		</div>
	);
}
