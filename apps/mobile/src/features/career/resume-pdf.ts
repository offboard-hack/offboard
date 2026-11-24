import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { type Resume } from "./model";
import { resumeHtml } from "@offboard/employee/resume-document";

export async function exportResumePdf(resume: Resume) {
  const html = resumeHtml(resume);

  if (Platform.OS === "web") {
    const preview = window.open("", "_blank");

    if (!preview)
      throw new Error("Permita abrir a nova aba do currículo para imprimir ou salvar em PDF.");
    preview.opener = null;
    preview.document.open();
    preview.document.write(html);
    preview.document.close();
    preview.focus();
    preview.print();

    return;
  }

  const android = Platform.OS === "android";
  const printed = await Print.printToFileAsync({ html, base64: android });
  let uri = printed.uri;

  if (android) {
    if (!printed.base64) throw new Error("Expo Print did not return PDF data.");

    const scopedPdf = new File(Paths.cache, `curriculo-offboard-${new File(printed.uri).name}`);
    await scopedPdf.write(printed.base64, { encoding: "base64" });
    uri = scopedPdf.uri;
  }

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
      dialogTitle: "Salvar ou compartilhar currículo",
    });
  } else {
    await Print.printAsync({ uri });
  }
}
