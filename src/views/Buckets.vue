<!-- src/views/Buckets.vue -->
<template>
  <div class="space-y-6">
    <!-- Create Bucket Section -->
    <div class="bg-white p-6 rounded-lg shadow-lg">
      <h2 class="text-xl font-bold mb-4">Create New Bucket</h2>
      <form @submit.prevent="createBucket" class="flex items-center space-x-2">
        <input
          v-model="newBucketName"
          type="text"
          placeholder="my-new-bucket"
          class="flex-grow block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
        />
        <button type="submit" class="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:bg-indigo-300" :disabled="!newBucketName || loading.create">
          <span v-if="!loading.create">Create</span>
          <span v-else>Creating...</span>
        </button>
      </form>
      <p v-if="error.create" class="text-red-500 mt-2">{{ error.create }}</p>
    </div>

    <!-- List Buckets Section -->
    <div class="bg-white p-6 rounded-lg shadow-lg">
      <h2 class="text-xl font-bold mb-4">All Buckets</h2>
      <div v-if="loading.list" class="text-center">Loading buckets...</div>
      <div v-else-if="error.list" class="text-red-500">{{ error.list }}</div>
      <ul v-else-if="buckets.length" class="space-y-3">
        <li v-for="bucket in buckets" :key="bucket.Name" class="flex items-center justify-between p-3 bg-gray-50 rounded-md border">
          <router-link :to="`/buckets/${bucket.Name}`" class="font-medium text-indigo-600 hover:underline">
            {{ bucket.Name }}
          </router-link>
          <button @click="deleteBucket(bucket.Name)" class="text-red-600 hover:text-red-800 disabled:text-gray-400" :disabled="loading.delete === bucket.Name">
            <span v-if="loading.delete === bucket.Name">Deleting...</span>
            <span v-else>Delete</span>
          </button>
        </li>
      </ul>
      <p v-else class="text-gray-500">No buckets found.</p>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { s3Client } from '../s3Client';
import {
  ListBucketsCommand,
  CreateBucketCommand,
  DeleteBucketCommand
} from '@aws-sdk/client-s3';

const buckets = ref([]);
const newBucketName = ref('');
const loading = reactive({ list: false, create: false, delete: null });
const error = reactive({ list: null, create: null });

async function fetchBuckets() {
  loading.list = true;
  error.list = null;
  try {
    const { Buckets } = await s3Client.send(new ListBucketsCommand({}));
    buckets.value = Buckets || [];
  } catch (e) {
    error.list = `Failed to fetch buckets: ${e.message}`;
    console.error(e);
  } finally {
    loading.list = false;
  }
}

async function createBucket() {
  if (!newBucketName.value) return;
  loading.create = true;
  error.create = null;
  try {
    await s3Client.send(new CreateBucketCommand({ Bucket: newBucketName.value }));
    newBucketName.value = '';
    await fetchBuckets(); // Refresh list
  } catch (e) {
    error.create = `Failed to create bucket: ${e.message}`;
    console.error(e);
  } finally {
    loading.create = false;
  }
}

async function deleteBucket(bucketName) {
  if (!confirm(`Are you sure you want to delete the bucket "${bucketName}"? This action cannot be undone.`)) {
    return;
  }
  loading.delete = bucketName;
  try {
    await s3Client.send(new DeleteBucketCommand({ Bucket: bucketName }));
    await fetchBuckets(); // Refresh list
  } catch (e) {
    alert(`Failed to delete bucket: ${e.message}`);
    console.error(e);
  } finally {
    loading.delete = null;
  }
}

onMounted(fetchBuckets);
</script>
