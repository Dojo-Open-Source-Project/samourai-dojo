import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type FormEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { type ApiKey, api, pairingPayload } from "../api";
import { errorMessage, Qr, useNotice } from "../ui";

export function PairingScreen() {
	const notice = useNotice();
	const query = useQuery({
		queryKey: ["pairing"],
		queryFn: ({ signal }) => api.pairing(signal),
	});
	const payload = query.data ? pairingPayload(query.data) : null;
	const value = payload ? JSON.stringify(payload) : "";
	async function copy() {
		try {
			await navigator.clipboard.writeText(JSON.stringify(payload, null, 4));
			notice.show("info", "Pairing payload copied to clipboard");
		} catch (error) {
			notice.show("error", errorMessage(error));
		}
	}
	return (
		<div id="pairing">
			<h1>PAIRING</h1>
			<div className="box-context">
				Pair your wallet to your Dojo and to your Block Explorer with a simple
				QRCode.
			</div>
			<div className="row box-main">
				<div id="dojo-pairing" className="fullwidth box pairing-box">
					<div className="pairing-qr-col">
						<div className="center">Scan this QRCode with your wallet</div>
						<div className="spacer10" />
						<div id="qr-container">
							<div id="qr-pairing">{value && <Qr value={value} />}</div>
						</div>
					</div>
					<div className="pairing-payload-col">
						<div className="pairing-payload-label">PAIRING PAYLOAD</div>
						<textarea
							id="dojo-pairing-payload"
							className="payload-textarea"
							rows={10}
							readOnly
							value={payload ? JSON.stringify(payload, null, 4) : ""}
						/>
						<div className="spacer10" />
						<div className="pairing-actions">
							<button
								type="button"
								className="btn btn-primary"
								onClick={copy}
								disabled={!payload}
							>
								Copy Payload
							</button>
						</div>
					</div>
				</div>
			</div>
			{query.isError && (
				<div role="alert" className="msg-error">
					{errorMessage(query.error)}
				</div>
			)}
		</div>
	);
}

function localDateTime(value: Date) {
	return new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
		.toISOString()
		.slice(0, 16);
}
function Modal({
	children,
	close,
	labelledBy,
}: {
	children: ReactNode;
	close: () => void;
	labelledBy: string;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const dialog = ref.current;
		dialog?.showModal();
		return () => dialog?.close();
	}, []);
	return (
		<dialog ref={ref} aria-labelledby={labelledBy} onClose={close}>
			{children}
		</dialog>
	);
}
function KeyDialog({
	selected,
	close,
	submit,
	pending,
}: {
	selected?: ApiKey;
	close: () => void;
	submit: (data: { label: string; expiresAt: Date; active: boolean }) => void;
	pending: boolean;
}) {
	const [label, setLabel] = useState(selected?.label ?? "");
	const [expiresAt, setExpiresAt] = useState(
		localDateTime(
			selected
				? new Date(selected.expiresAt)
				: new Date(Date.now() + 365 * 24 * 60 * 60_000),
		),
	);
	const [active, setActive] = useState(selected?.active ?? true);
	function onSubmit(event: FormEvent) {
		event.preventDefault();
		submit({ label, expiresAt: new Date(expiresAt), active });
	}
	return (
		<Modal close={close} labelledBy="key-dialog-title">
			<form onSubmit={onSubmit}>
				<div className="dialog-header">
					<h2 id="key-dialog-title">
						{selected ? "Edit API key" : "New API key"}
					</h2>
				</div>
				<div className="dialog-body">
					<div className="form-group">
						<label htmlFor="api-key-label">Label</label>
						<input
							id="api-key-label"
							type="text"
							placeholder="API key label"
							maxLength={30}
							required
							value={label}
							onChange={(e) => setLabel(e.target.value)}
						/>
					</div>
					<div className="spacer10" />
					<div className="form-group">
						<label htmlFor="api-key-expiration">Expiration</label>
						<input
							id="api-key-expiration"
							type="datetime-local"
							required
							min={localDateTime(new Date())}
							value={expiresAt}
							onChange={(e) => setExpiresAt(e.target.value)}
						/>
					</div>
					{selected && (
						<div className="checkbox">
							<label>
								<input
									type="checkbox"
									checked={active}
									onChange={(e) => setActive(e.target.checked)}
								/>{" "}
								Active
							</label>
						</div>
					)}
				</div>
				<div className="dialog-footer text-center">
					<button type="button" className="btn" onClick={close}>
						Cancel
					</button>
					<button type="submit" className="btn btn-primary" disabled={pending}>
						{selected ? "Update" : "Create"}
					</button>
				</div>
			</form>
		</Modal>
	);
}
export function ApiKeysScreen() {
	const notice = useNotice();
	const client = useQueryClient();
	const keys = useQuery({
		queryKey: ["api-keys"],
		queryFn: ({ signal }) => api.apiKeys(signal),
	});
	const pairing = useQuery({
		queryKey: ["pairing"],
		queryFn: ({ signal }) => api.pairing(signal),
	});
	const [dialog, setDialog] = useState<"new" | "edit" | "pairing" | null>(null);
	const [selected, setSelected] = useState<ApiKey>();
	const invalidate = () => client.invalidateQueries({ queryKey: ["api-keys"] });
	const create = useMutation({
		mutationFn: api.createKey,
		onSuccess: async () => {
			await invalidate();
			setDialog(null);
			notice.show("info", "API key created successfully");
		},
		onError: (error) => notice.show("error", errorMessage(error)),
	});
	const update = useMutation({
		mutationFn: ({
			key,
			data,
		}: {
			key: string;
			data: { label: string; expiresAt: Date; active: boolean };
		}) => api.updateKey(key, data),
		onSuccess: async () => {
			await invalidate();
			setDialog(null);
			notice.show("info", "API key updated successfully");
		},
		onError: (error) => notice.show("error", errorMessage(error)),
	});
	const remove = useMutation({
		mutationFn: api.deleteKey,
		onSuccess: async () => {
			await invalidate();
			notice.show("info", "API key deleted successfully");
		},
		onError: (error) => notice.show("error", errorMessage(error)),
	});
	const paired =
		selected && pairing.data
			? pairingPayload(pairing.data, selected.apikey)
			: null;
	return (
		<div id="pairing">
			<h1>API KEYS</h1>
			<div className="box-context">
				Provide other users an ability to connect to your Dojo.
			</div>
			<div className="row box-main">
				<div id="dojo-api-keys" className="fullwidth box">
					<div className="box-header">Your API keys</div>
					<div className="spacer10" />
					<div className="box-body fullwidth">
						<div className="spacer10" />
						<div id="api-key-container">
							{keys.isError ? (
								<div role="alert" className="msg-error">
									{errorMessage(keys.error)}
								</div>
							) : keys.isPending ? (
								"Loading API keys..."
							) : keys.data.length === 0 ? (
								"No API keys found"
							) : (
								<table className="table">
									<thead>
										<tr>
											<th>Label</th>
											<th>Created</th>
											<th>Expires</th>
											<th>State</th>
											<th />
										</tr>
									</thead>
									<tbody>
										{keys.data.map((key) => {
											const expired =
												new Date(key.expiresAt).getTime() < Date.now();
											return (
												<tr key={key.apikeyID}>
													<td>
														<a
															href={`#api-key-${key.apikeyID}`}
															onClick={(e) => {
																e.preventDefault();
																setSelected(key);
																setDialog("pairing");
															}}
														>
															{key.label}
														</a>
													</td>
													<td>{new Date(key.createdAt).toUTCString()}</td>
													<td className={expired ? "text-danger" : ""}>
														{new Date(key.expiresAt).toUTCString()}
													</td>
													<td>
														<span
															className={`chip ${expired ? "chip-ko" : key.active ? "chip-ok" : "chip-warn"}`}
														>
															{expired
																? "EXPIRED"
																: key.active
																	? "ACTIVE"
																	: "DISABLED"}
														</span>
													</td>
													<td>
														<div className="btn-group">
															<button
																type="button"
																className="btn btn-success btn-sm"
																onClick={() => {
																	setSelected(key);
																	setDialog("edit");
																}}
															>
																Edit
															</button>
															<button
																type="button"
																className="btn btn-danger btn-sm"
																onClick={() => {
																	if (
																		window.confirm(
																			"Are you sure you want to delete this API key?",
																		)
																	)
																		remove.mutate(key.apikey);
																}}
															>
																Delete
															</button>
														</div>
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							)}
						</div>
						<div className="spacer10" />
						<div className="text-center">
							<button
								type="button"
								className="btn btn-success"
								onClick={() => {
									setSelected(undefined);
									setDialog("new");
								}}
							>
								New API key
							</button>
						</div>
						<div className="spacer10" />
					</div>
				</div>
			</div>
			{(dialog === "new" || dialog === "edit") && (
				<KeyDialog
					key={selected?.apikey ?? "new"}
					selected={dialog === "edit" ? selected : undefined}
					close={() => setDialog(null)}
					pending={create.isPending || update.isPending}
					submit={(data) =>
						dialog === "edit" && selected
							? update.mutate({ key: selected.apikey, data })
							: create.mutate(data)
					}
				/>
			)}
			{dialog === "pairing" && selected && (
				<Modal close={() => setDialog(null)} labelledBy="pairing-heading">
					<div className="dialog-header">
						<h2 id="pairing-heading">{selected.label}</h2>
					</div>
					<div className="dialog-body">
						<div className="center">
							{paired && <Qr value={JSON.stringify(paired)} />}
						</div>
						<div className="spacer10" />
						<textarea
							className="payload-textarea"
							rows={10}
							readOnly
							value={paired ? JSON.stringify(paired, null, 4) : ""}
						/>
						<div className="spacer10" />
					</div>
					<div className="dialog-footer text-center">
						<button
							type="button"
							className="btn btn-default"
							onClick={() => setDialog(null)}
						>
							Close
						</button>
					</div>
				</Modal>
			)}
		</div>
	);
}
