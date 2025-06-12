<!-- src/views/Files.vue -->
<template>
  <div class="space-y-6">
    <h1 class="text-3xl font-bold text-gray-800">
      Bucket: <span class="text-indigo-600">{{ bucketName }}</span>
    </h1>

    <!-- Upload Section -->
    <div class="bg-white p-6 rounded-lg shadow-lg">
      <h2 class="text-xl font-bold mb-4">Upload Files to this Bucket</h2>
      <Dashboard v-if="uppy" :uppy="uppy" :props="{ theme: 'light', proudllyDisplayPoweredByUppy: false }" />
    </div>

    <!-- File List Section -->
    <div class="bg-white p-6 rounded-lg shadow-lg">
      <h2 class="text-xl font-bold mb-4">Files in Bucket</h2>
      <div v-if="loading.list" class="text-center">Loading files...</div>
      <div v-else-if="error.list" class="text-red-500">{{ error.list }}</div>
      <table v-else-if="files.length" class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
        <tr>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">File Name</th>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Modified</th>
          <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
        </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
        <tr v-for="file in files" :key="file.Key">
          <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{{ file.Key }}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{{ formatBytes(file.Size) }}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{{ new Date(file.LastModified).toLocaleString() }}</td>
          <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
            <button @click="deleteFile(file.Key)" class="text-red-600 hover:text-red-800 disabled:text-gray-400" :disabled="loading.delete === file.Key">
              <span v-if="loading.delete === file.Key">Deleting...</span>
              <span v-else>Delete</span>
            </button>
          </td>
        </tr>
        </tbody>
      </table>
      <p v-else class="text-gray-500">No files found in this bucket.</p>
    </div>
  </div>
</template>

<!-- src/views/Files.vue -->
<script setup>
import { ref, reactive, onMounted, onUnmounted, defineProps } from 'vue';
import { s3Client } from '../s3Client';
import {
  ListObjectsV2Command,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
} from '@aws-sdk/client-s3';

import { Dashboard } from '@uppy/vue';
import Uppy from '@uppy/core';
import AwsS3Multipart from '@uppy/aws-s3-multipart';

const props = defineProps({
  bucketName: {
    type: String,
    required: true,
  },
});

const files = ref([]);
const loading = reactive({ list: false, delete: null });
const error = reactive({ list: null });
const uppy = ref(null);

async function fetchFiles() {
  loading.list = true;
  error.list = null;
  try {
    const { Contents } = await s3Client.send(new ListObjectsV2Command({ Bucket: props.bucketName }));
    files.value = (Contents || []).sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
  } catch (e) {
    error.list = `Failed to fetch files: ${e.message}`;
    console.error(e);
  } finally {
    loading.list = false;
  }
}

async function deleteFile(key) {
  if (!confirm(`Are you sure you want to delete the file "${key}"?`)) {
    return;
  }
  loading.delete = key;
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: props.bucketName, Key: key }));
    await fetchFiles(); // Refresh list
  } catch (e) {
    alert(`Failed to delete file: ${e.message}`);
    console.error(e);
  } finally {
    loading.delete = null;
  }
}

const formatBytes = (bytes, decimals = 2) => {
  if (!bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};


onMounted(() => {
  fetchFiles();

  uppy.value = new Uppy({
    autoProceed: true,
    debug: true,
  }).use(AwsS3Multipart, {
    // 核心修正 1：添加一个空的 getUploadParameters 函数来绕过插件的检查
    getUploadParameters(file) {
      // We are not using Companion, so we don't need to return signed URLs here.
      // The five functions below will be used instead.
      // This is just to satisfy the plugin's internal checks.
      return {
        method: 'PUT', // Or any other method, it won't be used
        url: '',       // This won't be used
        fields: {},
        headers: {},
      };
    },
    // 核心修正 2：确保所有五个函数都已实现
    createMultipartUpload: async (file) => {
      const cmd = new CreateMultipartUploadCommand({ Bucket: props.bucketName, Key: file.name, ContentType: file.type });
      const data = await s3Client.send(cmd);
      return { uploadId: data.UploadId, key: data.Key };
    },
    listParts: async (file, { uploadId, key }) => {
      const cmd = new ListPartsCommand({ Bucket: props.bucketName, Key: key, UploadId: uploadId });
      const data = await s3Client.send(cmd);
      return (data.Parts || []).map(p => ({ PartNumber: p.PartNumber, ETag: p.ETag, Size: p.Size }));
    },
    // 之前遗漏的 uploadPart 函数
    uploadPart: async (file, part) => {
      const cmd = new UploadPartCommand({
        Bucket: props.bucketName,
        Key: part.key,
        UploadId: part.uploadId,
        PartNumber: part.partNumber,
        Body: part.body
      });
      const resp = await s3Client.send(cmd);
      // Uppy's aws-s3-multipart plugin now seems to expect a presigned URL in some flows.
      // For direct uploads like this, we simulate the 'uploadURL' for its internal logic.
      // And importantly, return the ETag in the headers.
      return {
        uploadURL: 'will-not-be-used', // Placeholder
        headers: { 'ETag': resp.ETag }
      };
    },
    abortMultipartUpload: async (file, { uploadId, key }) => {
      const cmd = new AbortMultipartUploadCommand({ Bucket: props.bucketName, Key: key, UploadId: uploadId });
      await s3Client.send(cmd);
    },
    completeMultipartUpload: async (file, { uploadId, key, parts }) => {
      // 在新版 Uppy 中，parts 可能不包含 ETag，需要从 uploadPart 的结果中获取
      // 但我们的 uploadPart 实现简单，这里假设 Uppy 内部处理了 ETag 的收集
      const mappedParts = parts.map(p => ({ PartNumber: p.PartNumber, ETag: p.ETag }));

      const cmd = new CompleteMultipartUploadCommand({
        Bucket: props.bucketName,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: mappedParts },
      });
      const data = await s3Client.send(cmd);
      return { location: data.Location };
    },
  });

  uppy.value.on('complete', (result) => {
    if (result.successful.length > 0) {
      console.log('Upload complete! Refreshing file list.');
      // 增加一点延迟，确保 S3 后端数据同步
      setTimeout(fetchFiles, 1500);
    }
    if (result.failed.length > 0) {
      console.error('Upload failed:', result.failed);
    }
  });
});

onUnmounted(() => {
  if (uppy.value) {
    uppy.value.close();
  }
});
</script>
