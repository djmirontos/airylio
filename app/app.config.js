export default {
  expo: {
    name: "Airylio",
    slug: "airylio",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    newArchEnabled: false,
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
      // Keyed off the OS appearance, which is all the native splash can know
      // before JS starts - it cannot see the in-app theme toggle. Matches
      // DARK_COLORS.canvas so a dark-mode launch does not flash white.
      dark: {
        image: "./assets/splash-icon.png",
        resizeMode: "contain",
        backgroundColor: "#0F1020",
      },
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.daryljm.airylio",
    },
    android: {
      package: "com.daryljm.airylio",
      versionCode: 5,
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON || "./google-services.json",
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#ffffff",
      },
      edgeToEdgeEnabled: false,
      predictiveBackGestureEnabled: false,
      config: {
        googleMaps: {
          apiKey: process.env.GOOGLE_MAPS_API_KEY || "",
        },
      },
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    plugins: [
      "expo-dev-client",
      "@react-native-community/datetimepicker",
      "expo-font",
      [
        "expo-notifications",
        {
          icon: "./assets/icon.png",
          color: "#4C4F9E",
        },
      ],
      [
        "@sentry/react-native/expo",
        {
          organization: "airylio",
          project: "react-native",
        },
      ],
    ],
    extra: {
      eas: {
        projectId: "0a28dcc0-d4be-4c99-8bd5-7c4a36049d3a",
      },
    },
    owner: "daryljm",
  },
};
