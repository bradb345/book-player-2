import { Component, type ErrorInfo, type ReactNode } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/theme";
import { sharedStyles } from "@/constants/styles";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught error in render tree:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View style={[sharedStyles.container, styles.root]}>
        <Ionicons name="warning-outline" size={56} color={colors.red} />
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.subtitle}>
          The app hit an unexpected error. Try again — if it keeps happening,
          please report it.
        </Text>
        <ScrollView style={styles.detailBox} contentContainerStyle={styles.detailContent}>
          <Text style={styles.detailText}>{this.state.error.message}</Text>
        </ScrollView>
        <Pressable style={styles.button} onPress={this.handleReset}>
          <Text style={styles.buttonText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.white,
    marginTop: 8,
  },
  subtitle: {
    fontSize: 14,
    color: colors.lightGrey,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 8,
  },
  detailBox: {
    maxHeight: 160,
    width: "100%",
    backgroundColor: colors.mediumGrey,
    borderRadius: 10,
  },
  detailContent: {
    padding: 12,
  },
  detailText: {
    fontSize: 12,
    color: colors.lightGrey,
    fontFamily: "monospace",
  },
  button: {
    backgroundColor: colors.red,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 10,
    marginTop: 8,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.white,
  },
});
