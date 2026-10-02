import { Feather } from "../../lib/icons";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { getPreview } from "../../lib/api";
import { authHeaders } from "../../lib/config";
import { haptics } from "../../lib/haptics";
import { BrowserLivePane } from "../../lib/preview/BrowserLivePane";
import { useApp } from "../../lib/store";
import type { Theme } from "../../lib/theme";
import { useTheme, useThemedStyles } from "../../lib/ThemeProvider";
import { iconSize, space, type } from "../../lib/tokens";
import { userFacingError } from "../../lib/connectionError";

type AppPreview = { entry: string; url: string; authenticated: boolean };

/** One preview surface for the session browser and any generated app/document preview. */
export default function SessionPreviewScreen() {
	const { id: rawID, title, previewUrl } = useLocalSearchParams<{ id: string; title?: string; previewUrl?: string }>();
	const sessionID = String(rawID ?? "");
	const navigation = useNavigation();
	const { config } = useApp();
	const t = useTheme();
	const styles = useThemedStyles(makeStyles);
	const web = useRef<WebView>(null);
	const [active, setActive] = useState<"browser" | "app">("browser");
	const [preview, setPreview] = useState<AppPreview | null>(null);
	const [previewError, setPreviewError] = useState<string>();

	useLayoutEffect(() => {
		navigation.setOptions({ title: title || "Preview" });
	}, [navigation, title]);

	const refreshPreview = useCallback(async () => {
		if (!config || !sessionID) return;
		try {
			const next = await getPreview(config, sessionID, previewUrl);
			setPreview(next);
			setPreviewError(undefined);
		} catch (cause) {
			setPreviewError(userFacingError(cause));
		}
	}, [config, previewUrl, sessionID]);

	useEffect(() => {
		void refreshPreview();
		const poll = setInterval(() => void refreshPreview(), 5_000);
		return () => clearInterval(poll);
	}, [refreshPreview]);

	return <View style={styles.screen}>
		{preview ? <View accessibilityRole="tablist" style={styles.switcher}>
			<PreviewTab label="Browser" icon="monitor" selected={active === "browser"} onPress={() => setActive("browser")} />
			<PreviewTab label="App preview" icon="globe" selected={active === "app"} onPress={() => setActive("app")} />
		</View> : null}
		{active === "browser" || !preview ? <BrowserLivePane sessionID={sessionID} /> : <View style={styles.appPane}>
			<View style={styles.appBar}>
				<Feather name="globe" size={iconSize.sm} color={t.textTertiary} />
				<Text numberOfLines={1} style={styles.appPath}>{preview.entry}</Text>
				<Pressable accessibilityRole="button" accessibilityLabel="Reload app preview" hitSlop={10} onPress={() => { haptics.tap(); web.current?.reload(); }} style={styles.appAction}>
					<Feather name="refresh-cw" size={iconSize.sm} color={t.textSecondary} />
				</Pressable>
			</View>
			<WebView
				ref={web}
				source={{ uri: preview.url, headers: preview.authenticated && config ? authHeaders(config) : undefined }}
				style={styles.web}
				startInLoadingState
				renderLoading={() => <View style={styles.webLoading}><ActivityIndicator color={t.accent} /></View>}
				onLoadStart={() => setPreviewError(undefined)}
				onHttpError={(event) => setPreviewError(previewHttpErrorCopy(event.nativeEvent.statusCode))}
				onError={(event) => setPreviewError(event.nativeEvent.description || "Couldn't load this preview.")}
			/>
			{previewError ? <View accessibilityRole="alert" style={styles.webError}>
				<Feather name="alert-triangle" size={iconSize.sm} color={t.red} />
				<Text style={styles.webErrorText}>{previewError}</Text>
				<Pressable onPress={() => { haptics.tap(); setPreviewError(undefined); web.current?.reload(); }}><Text style={styles.retryText}>Retry</Text></Pressable>
			</View> : null}
		</View>}
	</View>;
}

function PreviewTab({ label, icon, selected, onPress }: { label: string; icon: "monitor" | "globe"; selected: boolean; onPress(): void }) {
	const t = useTheme();
	const styles = useThemedStyles(makeStyles);
	return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => { haptics.tap(); onPress(); }} style={[styles.switcherTab, selected && styles.switcherTabActive]}>
		<Feather name={icon} size={iconSize.sm} color={selected ? t.textPrimary : t.textTertiary} />
		<Text style={[styles.switcherLabel, selected && styles.switcherLabelActive]}>{label}</Text>
	</Pressable>;
}

const makeStyles = (t: Theme) => StyleSheet.create({
	screen: { flex: 1, backgroundColor: t.bgBase },
	switcher: { flexDirection: "row", gap: space.xs, paddingHorizontal: space.sm, paddingVertical: space.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.borderSubtle, backgroundColor: t.bgSurface },
	switcherTab: { flex: 1, minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, borderRadius: 11 },
	switcherTabActive: { backgroundColor: t.bgElevated },
	switcherLabel: { color: t.textTertiary, fontFamily: "Geist_500Medium", fontSize: type.footnote.fontSize },
	switcherLabelActive: { color: t.textPrimary },
	appPane: { flex: 1, backgroundColor: t.bgBase },
	appBar: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: space.md, paddingRight: space.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.borderSubtle, backgroundColor: t.bgSurface },
	appPath: { flex: 1, color: t.textSecondary, fontFamily: "Geist_400Regular", fontSize: type.footnote.fontSize },
	appAction: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 12 },
	web: { flex: 1, backgroundColor: t.bgBase },
	webLoading: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: t.bgBase },
	webError: { position: "absolute", left: 12, right: 12, bottom: 16, minHeight: 48, flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: 12, borderCurve: "continuous", borderWidth: 1, borderColor: t.tintRed, backgroundColor: t.bgElevated, paddingHorizontal: space.md, paddingVertical: space.sm },
	webErrorText: { flex: 1, color: t.textSecondary, fontFamily: "Geist_400Regular", fontSize: type.caption2.fontSize, lineHeight: type.caption2.lineHeight },
	retryText: { color: t.accent, fontFamily: "Geist_600SemiBold", fontSize: type.caption1.fontSize, fontWeight: "600" },
});

export { RouteErrorBoundary as ErrorBoundary } from "../../lib/RouteErrorBoundary";

function previewHttpErrorCopy(status: number): string {
	if (status === 404 || status === 410) return "This page wasn't found. The agent may have moved or removed it.";
	if (status === 401 || status === 403) return "This page needs access this phone doesn't have.";
	if (status >= 500) return "The page's server hit an error. Check that the agent's dev server is running, then retry.";
	return "This page didn't load. Retry, or check it on your desktop.";
}
